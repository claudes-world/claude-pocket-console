# **UI Package (packages/ui)**

>Author: Gemini 2.5

This package contains a library of shared, reusable React components for use across all web applications in the monorepo. It is built upon shadcn/ui and Tailwind CSS, providing a consistent, accessible, and themeable set of building blocks.

## **Core Purpose**

* **Consistency:** Ensures all frontend applications share a consistent visual language and user experience.  
* **Reusability:** Avoids code duplication by providing a central library for common UI elements like buttons, cards, and form inputs.  
* **Isolation:** Allows for developing and testing UI components in isolation from application business logic.

## **Key Components**

This package exports a range of components, including:

* **TerminalPane**: A specialized component that wraps xterm.js for displaying the terminal.  
* **ReconnectIndicator**: A small UI element to show the status of the WebSocket connection.  
* **ThemeToggle**: A button to switch between light and dark themes.  
* **Card**: A styled container component, used as a base for most UI surfaces.  
* Standard shadcn/ui components like Button, Input, Dialog, etc.

## **Usage**

Components from this package can be imported directly into any application within the monorepo (e.g., apps/web).

// Example: Using the Card and Button components in a page  
import {  
  Card,  
  CardContent,  
  CardDescription,  
  CardHeader,  
  CardTitle,  
} from '@cpc/ui/card';  
import { Button } from '@cpc/ui/button';

export function SessionCard() {  
  return (  
    \<Card\>  
      \<CardHeader\>  
        \<CardTitle\>New Session\</CardTitle\>  
        \<CardDescription\>Start a new secure terminal session.\</CardDescription\>  
      \</CardHeader\>  
      \<CardContent\>  
        \<Button\>Launch Terminal\</Button\>  
      \</CardContent\>  
    \</Card\>  
  );  
}

## **Development & Storybook**

To facilitate development and visual testing, we use **Storybook**. It allows you to build and view components in an isolated development environment.

1. **Navigate to the package directory:**  
   cd packages/ui

2. **Run Storybook:**  
   pnpm run storybook

This will launch the Storybook interface, typically at http://localhost:6006, where you can see all available components and interact with their different states and props.