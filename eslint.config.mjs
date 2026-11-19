import js from "@eslint/js";

export default [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: {
				console: "readonly",
				process: "readonly",
				require: "readonly",
				module: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
				exports: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
			},
		},
		rules: {
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"no-console": "off",
			"prefer-const": "error",
			eqeqeq: ["error", "always"],
			"no-var": "error",
		},
	},
	{
		ignores: ["node_modules/", "docs/", "coverage/"],
	},
];
