export const demoState = {
  schemaVersion: 3,
  kids: [
    { id: "demo-maya", name: "🐼 Maya" },
    { id: "demo-theo", name: "🦊 Theo" },
    { id: "demo-ruby", name: "🐙 Ruby" },
    { id: "demo-leo", name: "🦖 Leo" }
  ],
  transactions: [
    { id: "demo-maya-short", kidId: "demo-maya", category: "Short Term", amount: 35, kind: "balance-set", note: "Starting balance", time: 1787756400000 },
    { id: "demo-maya-spend", kidId: "demo-maya", category: "Short Term", amount: -8.25, note: "Art supplies", time: 1787763600000 },
    { id: "demo-maya-long", kidId: "demo-maya", category: "Long Term", amount: 64.5, kind: "balance-set", note: "Starting balance", time: 1787756400001 },
    { id: "demo-maya-vlt", kidId: "demo-maya", category: "Very Long Term", amount: 215, kind: "balance-set", note: "Starting balance", time: 1787756400002 },

    { id: "demo-theo-short", kidId: "demo-theo", category: "Short Term", amount: 18.4, kind: "balance-set", note: "Starting balance", time: 1787756460000 },
    { id: "demo-theo-spend", kidId: "demo-theo", category: "Short Term", amount: -4.75, note: "Comic book", time: 1787764200000 },
    { id: "demo-theo-long", kidId: "demo-theo", category: "Long Term", amount: 52.1, kind: "balance-set", note: "Starting balance", time: 1787756460001 },
    { id: "demo-theo-vlt", kidId: "demo-theo", category: "Very Long Term", amount: 180, kind: "balance-set", note: "Starting balance", time: 1787756460002 },

    { id: "demo-ruby-short", kidId: "demo-ruby", category: "Short Term", amount: 27.9, kind: "balance-set", note: "Starting balance", time: 1787756520000 },
    { id: "demo-ruby-spend", kidId: "demo-ruby", category: "Short Term", amount: -6.3, note: "Craft kit", time: 1787764800000 },
    { id: "demo-ruby-long", kidId: "demo-ruby", category: "Long Term", amount: 38.25, kind: "balance-set", note: "Starting balance", time: 1787756520001 },
    { id: "demo-ruby-vlt", kidId: "demo-ruby", category: "Very Long Term", amount: 142.5, kind: "balance-set", note: "Starting balance", time: 1787756520002 },

    { id: "demo-leo-short", kidId: "demo-leo", category: "Short Term", amount: 12.75, kind: "balance-set", note: "Starting balance", time: 1787756580000 },
    { id: "demo-leo-spend", kidId: "demo-leo", category: "Short Term", amount: -3.5, note: "Toy car", time: 1787765400000 },
    { id: "demo-leo-long", kidId: "demo-leo", category: "Long Term", amount: 31.8, kind: "balance-set", note: "Starting balance", time: 1787756580001 },
    { id: "demo-leo-vlt", kidId: "demo-leo", category: "Very Long Term", amount: 96.25, kind: "balance-set", note: "Starting balance", time: 1787756580002 }
  ]
};
