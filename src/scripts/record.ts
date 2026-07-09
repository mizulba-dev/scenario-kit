export {};

const scenario = process.argv[2] ?? 'paput';
await import(`../scenarios/${scenario}`);
