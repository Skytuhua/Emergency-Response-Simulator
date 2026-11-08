// Record the expanded observer with locally intercepted map tiles.
process.env.RECORD_EXPANDED = '1';
await import('./browser-check-expanded.mjs');
