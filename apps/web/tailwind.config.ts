import type { Config } from "tailwindcss"

const config: Config = {
  // Content paths for Tailwind to scan
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    // Include UI package components
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  
  theme: {
    extend: {
      // Custom theme extensions will go here
    },
  },
  
  plugins: [
    // Tailwind plugins will be added here as needed
  ],
}

export default config