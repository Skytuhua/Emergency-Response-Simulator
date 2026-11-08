"""Bounded Responses transport for pinned MiroFish's Chat Completions callers.

This adapter translates transport objects only. The upstream generator and OASIS
still choose and execute their own actions. The caller owns billing reservations,
input limits, call counts, timeouts, and SDK retry configuration.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai.types.chat import ChatCompletion

TERRA_MODEL = "gpt-6.1-terra"
MAX_OUTPUT_TOKENS = 4096


@dataclass
class _ToolTurn:
    inputs: list[dict[str, Any]]
    output: list[dict[str, Any]]
    calls: dict[str, dict[str, Any]]


class TerraResponsesBridge:
    """Translate the supported text/function subset, without model fallback.

    Tool continuations must use this bridge instance so original reasoning items
    can be replayed. Unknown or edited tool history is rejected before I/O.
    """

    def __init__(self, work: Path | None = None):
        if work is not None and not work.is_dir():
            raise ValueError("Terra evidence directory must already exist")
        self.work = work
        self._turns: dict[str, _ToolTurn] = {}

    def create(self, resource: Any, request: dict[str, Any], request_index: int) -> ChatCompletion:
        """Call the owning synchronous SDK client's Responses endpoint once."""
        return self.create_prepared(resource, self.prepare(request, request_index), request_index)

    async def acreate(self, resource: Any, request: dict[str, Any], request_index: int) -> ChatCompletion:
        """Call the owning asynchronous SDK client's Responses endpoint once."""
        return await self.acreate_prepared(resource, self.prepare(request, request_index), request_index)

    def create_prepared(self, resource: Any, prepared: dict[str, Any], request_index: int) -> ChatCompletion:
        """Execute the exact body already expanded and reserved by CallGuard."""
        response = resource._client.responses.create(**prepared)
        return self._finish(response, prepared["input"], request_index)

    async def acreate_prepared(self, resource: Any, prepared: dict[str, Any], request_index: int) -> ChatCompletion:
        """Execute the exact asynchronous body already reserved by CallGuard."""
        response = await resource._client.responses.create(**prepared)
        return self._finish(response, prepared["input"], request_index)

    def prepare(self, request: dict[str, Any], request_index: int) -> dict[str, Any]:
        """Expand transport history before the caller measures or reserves it."""
        if type(request_index) is not int or request_index < 0:
            raise ValueError("Terra request index must be a nonnegative integer")
        if self.work is not None and (self.work / f"responses-{request_index}.json").exists():
            raise FileExistsError("Terra response evidence already exists for this request")
        allowed = {"model", "messages", "temperature", "max_tokens", "max_completion_tokens", "stream",
                   "n", "response_format", "tools", "tool_choice", "parallel_tool_calls", "reasoning_effort"}
        if not isinstance(request, dict) or set(request) - allowed:
            raise ValueError("Unsupported Terra Chat Completions request fields")
        if request.get("model") != TERRA_MODEL:
            raise ValueError("Terra bridge requires the exact gpt-6.1-terra model")
        if request.get("stream") not in (None, False) or request.get("n") not in (None, 1):
            raise ValueError("Terra bridge supports one non-streaming completion")
        if request.get("reasoning_effort") not in (None, "low"):
            raise ValueError("Terra bridge requires low reasoning effort")
        kwargs: dict[str, Any] = {
            "model": TERRA_MODEL, "input": self._messages(request.get("messages")),
            "max_output_tokens": MAX_OUTPUT_TOKENS, "reasoning": {"effort": "low"},
            "service_tier": "default", "store": False, "stream": False,
            "include": ["reasoning.encrypted_content"],
        }
        # Upstream temperature and token caps are deliberately not forwarded.
        # In CAMEL, max_tokens also controls context retention; API output has
        # the separate hard cap above, including reasoning tokens.
        response_format = request.get("response_format")
        if response_format is not None:
            if response_format != {"type": "json_object"}:
                raise ValueError("Terra bridge supports only JSON-object response formatting")
            kwargs["text"] = {"format": {"type": "json_object"}}
        tools = request.get("tools")
        if tools is not None:
            if not isinstance(tools, list):
                raise ValueError("Terra tools must be a list of function schemas")
            kwargs["tools"] = [self._tool(tool) for tool in tools]
        choice = request.get("tool_choice")
        if choice is not None:
            if isinstance(choice, str) and choice in {"auto", "required", "none"}:
                kwargs["tool_choice"] = choice
            elif (isinstance(choice, dict) and set(choice) == {"type", "function"}
                  and choice.get("type") == "function" and isinstance(choice.get("function"), dict)
                  and set(choice["function"]) == {"name"}
                  and isinstance(choice["function"]["name"], str) and choice["function"]["name"]):
                kwargs["tool_choice"] = {"type": "function", "name": choice["function"]["name"]}
            else:
                raise ValueError("Unsupported Terra function tool choice")
        parallel = request.get("parallel_tool_calls")
        if parallel is not None:
            if type(parallel) is not bool:
                raise ValueError("Terra parallel_tool_calls must be a boolean")
            kwargs["parallel_tool_calls"] = parallel
        return kwargs

    @staticmethod
    def _tool(tool: Any) -> dict[str, Any]:
        if (not isinstance(tool, dict) or set(tool) != {"type", "function"}
                or tool.get("type") != "function" or not isinstance(tool.get("function"), dict)):
            raise ValueError("Terra bridge supports function tools only")
        function = tool["function"]
        if (set(function) - {"name", "description", "parameters", "strict"}
                or not isinstance(function.get("name"), str) or not function["name"]
                or not isinstance(function.get("parameters"), dict)
                or ("description" in function and not isinstance(function["description"], str))):
            raise ValueError("Unsupported Terra function schema")
        result = {"type": "function", "name": function["name"],
                  "parameters": copy.deepcopy(function["parameters"]), "strict": False}
        if "description" in function:
            result["description"] = function["description"]
        return result

    def _messages(self, messages: Any) -> list[dict[str, Any]]:
        if not isinstance(messages, list) or not messages:
            raise ValueError("Terra bridge requires nonempty text message history")
        declared: set[str] = set()
        for message in messages:
            if not isinstance(message, dict):
                raise ValueError("Unsupported Terra message")
            calls = message.get("tool_calls", [])
            if not isinstance(calls, list):
                raise ValueError("Unsupported Terra function call history")
            for call in calls:
                if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not call["id"]:
                    raise ValueError("Terra function history requires call IDs")
                if call["id"] in declared:
                    raise ValueError("Duplicate Terra function call history")
                declared.add(call["id"])

        items: list[dict[str, Any]] = []
        emitted: set[str] = set()
        pending: set[str] = set()
        for message in messages:
            role = message.get("role")
            calls = message.get("tool_calls", [])
            if calls:
                if (role != "assistant" or set(message) - {"role", "content", "tool_calls"}
                        or message.get("content") not in (None, "")):
                    raise ValueError("Unsupported Terra assistant function history")
                for call in calls:
                    turn = self._turns.get(call["id"])
                    if turn is None:
                        raise ValueError("Original Terra reasoning for this function call is unavailable")
                    original = turn.calls[call["id"]]
                    function = call.get("function")
                    if (set(call) != {"id", "type", "function"} or call.get("type") != "function"
                            or not isinstance(function, dict) or set(function) != {"name", "arguments"}
                            or function["name"] != original["name"]
                            or not self._same_arguments(function["arguments"], original["arguments"])):
                        raise ValueError("Terra function history differs from the original response")
                    if call["id"] not in emitted:
                        if set(turn.calls) - declared or items != turn.inputs:
                            raise ValueError("Terra reasoning requires its complete original input history")
                        items.extend(copy.deepcopy(turn.output))
                        emitted.update(turn.calls)
                        pending.update(turn.calls)
                continue
            if role == "tool":
                call_id = message.get("tool_call_id")
                if (set(message) != {"role", "tool_call_id", "content"} or call_id not in pending
                        or not isinstance(message.get("content"), str)):
                    raise ValueError("Terra tool output has no matching original function call")
                items.append({"type": "function_call_output", "call_id": call_id, "output": message["content"]})
                pending.remove(call_id)
                continue
            if (role not in {"system", "developer", "user", "assistant"}
                    or set(message) != {"role", "content"} or not isinstance(message.get("content"), str)
                    or pending):
                raise ValueError("Terra bridge supports text messages and complete function outputs only")
            items.append({"role": role, "content": message["content"]})
        if pending:
            raise ValueError("Terra function history is missing tool outputs")
        return items

    @staticmethod
    def _same_arguments(left: Any, right: str) -> bool:
        if not isinstance(left, str):
            return False
        try:
            return json.loads(left) == json.loads(right)
        except (ValueError, TypeError):
            return False

    def _finish(self, response: Any, inputs: list[dict[str, Any]], request_index: int) -> ChatCompletion:
        raw = response.model_dump(mode="json")
        if self.work is not None:
            with (self.work / f"responses-{request_index}.json").open("x", encoding="utf-8") as evidence:
                json.dump(raw, evidence, ensure_ascii=False, indent=2)
        if response.model != TERRA_MODEL or response.status not in {"completed", "incomplete"} or response.error:
            raise ValueError("Terra returned an unsuccessful response or a different model; raw evidence retained")
        content: list[str] = []
        refusals: list[str] = []
        calls: list[dict[str, Any]] = []
        incomplete = response.status == "incomplete"
        for item in response.output:
            if getattr(item, "status", None) == "incomplete":
                incomplete = True
            if item.type == "message":
                for part in item.content:
                    if part.type == "output_text":
                        content.append(part.text)
                    elif part.type == "refusal":
                        refusals.append(part.refusal)
                    else:
                        raise ValueError("Unsupported Terra output content; raw evidence retained")
            elif item.type == "function_call":
                calls.append({"id": item.call_id, "type": "function",
                              "function": {"name": item.name, "arguments": item.arguments}})
            elif item.type != "reasoning":
                raise ValueError("Unsupported Terra output item; raw evidence retained")
        # CAMEL executes tool_calls regardless of finish_reason. Never expose
        # calls from an incomplete/refused response as executable actions.
        if incomplete or refusals:
            calls = []
        if calls:
            output = [item.model_dump(mode="json", exclude_none=True) for item in response.output]
            call_items = {item["call_id"]: item for item in output if item["type"] == "function_call"}
            if len(call_items) != len(calls) or any(call_id in self._turns for call_id in call_items):
                raise ValueError("Duplicate Terra response function IDs; raw evidence retained")
            turn = _ToolTurn(copy.deepcopy(inputs), output, call_items)
            self._turns.update({call_id: turn for call_id in call_items})
        usage = None
        if response.usage is not None:
            source = response.usage
            usage = {"prompt_tokens": source.input_tokens, "completion_tokens": source.output_tokens,
                     "total_tokens": source.total_tokens,
                     "prompt_tokens_details": {"cached_tokens": source.input_tokens_details.cached_tokens},
                     "completion_tokens_details": {"reasoning_tokens": source.output_tokens_details.reasoning_tokens}}
        finish_reason = "length" if incomplete else "content_filter" if refusals else "tool_calls" if calls else "stop"
        return ChatCompletion(
            id=response.id, created=int(response.created_at), model=response.model, object="chat.completion",
            service_tier=response.service_tier, usage=usage,
            choices=[{"index": 0, "finish_reason": finish_reason,
                      "message": {"role": "assistant", "content": "".join(content),
                                  "refusal": "".join(refusals) or None, "tool_calls": calls or None}}],
        )
