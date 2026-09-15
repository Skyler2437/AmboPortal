import type { Config } from "tailwindcss";
import sharedConfig from "@ambo/config/tailwind.config";

const config: Config = {
	...sharedConfig,
	theme: {
		...sharedConfig.theme,
		extend: {
			...sharedConfig.theme?.extend,
			fontFamily: { sans: ["var(--font-sans)"] },
			borderRadius: {
				...sharedConfig.theme?.extend?.borderRadius,
				xl: "0.875rem",
			},
			boxShadow: {
				DEFAULT: "var(--shadow-sm)",
				xs: "var(--shadow-xs)",
				sm: "var(--shadow-sm)",
				md: "var(--shadow-md)",
				lg: "var(--shadow-lg)",
				xl: "var(--shadow-xl)",
			},
		},
	},
	content: [
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
		"../../packages/*/src/**/*.{ts,tsx}",
	],
	plugins: [require("tailwindcss-animate")],
};
export default config;
