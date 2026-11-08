# Authored behavior regression input

`authored-chain.json` is an authored parser/runtime fixture. Its synthetic
responses, hashes and platform row are deliberately constructed test values.
There were no provider calls and no actual MiroFish/OASIS execution behind this
fixture. It must never enter the Dallas release or direct-actor count.

Production preparation uses `tools/v2/prepare_behavior.py freeze`, the
coordinator's explicit shared-budget gate, actual pinned upstream execution,
and private raw-file verification before portable export. Portable compact
evidence establishes consistency with the retained source chain; it is not
cryptographic authentication by the provider.
