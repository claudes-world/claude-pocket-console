I am trying to design a mobile app for controlling a remote LLM agent terminal. I want to be able to send
# Convex Chef - App Requirements

Please create an app using shadcn and tailwind v4. use nextjs 15.3 with app router.
>this app is meant for mobile phones. 100% of design focus should be for mobile.


## App Requirements

- All pages have light/dark mode.
- all pages except splash screen have a header with a logo, and a settings gear button.


The app should have:
1) a splash screen
2) a clean user login flow
- with github oauth
3) a home screen with cards that let you select a 'session'
- sessions are displayed in cards in a grid or list layout.
- sessions have a title, description, icon/image, and a button to launch the session, a link to the session's github page, and a settings gear button.
- there is a FOB button to add a new session.
- the session settings gear button opens a modal with the session's settings.
3.1) the session settings modal has
- there is settings to kill the session. (with a confirmation modal)
- there is settings to delete the session. (with a confirmation modal)
- there is settings button to restart the session. (with a confirmation modal)
4) a settings screen
- has a button to logout.
- settings can be organized into sections.
- we need a section to edit the user's profile.
- we need a section to control SSH keys.

We will need to setup the backend to store the following:
- users auth and session tokens
- sessions (tracking different instances of a terminal session)
- .env variables (encrypted)
- SSH keys (encrypted)
- user profile (name, email, avatar)

---

## Session UI

There are 3 main session screens:
1) terminal
2) chat
3) files
4) memories
5) settings

A button container group will appear in the header when we are in a session. This will have 3 buttons to navigate between the 3 screens. (or maybe this should be a tab container?). It would really love it if we could swipe between the screens too.

1) session screen - terminal (default screen)
where the top half of the screen is a pretty formated terminal window. 
the bottom half is a tab container with 4 tabs: prompts, tasks, raw, and tools.
1.1) the prompts tab has cards in it. each card has a title, description, and an accordion that can be expanded to show the prompt.
- there is a settings gear button in the top right of the prompts tab. this opens a modal that lets you add/edit/remove saved prompts.
1.2) the tasks tab can be empty for now.
1.3) the raw tab has a text area for sending terminal input. there is a big send button and clear button at the bottom. also along the top there are buttons for common bash commands.
- there is a settings gear button in the top right of the raw tab. this opens a modal that lets you add/edit/remove saved bash commands.
1.4) the tools tab has a list of available tools.
- we will show a table of the available MCP servers (headers) and their tools.
- there is a toggle button to enable/disable each MCP server.

2) a session screen - chat
a chatbot interface for the LLM agent. this will call `bash claude -p "<prompt>" --dangerously-enable-all --session-id <session-id> --mcp-server <mcp-server-json>`.
- chat, voice, file, and image input. big button to send the message.
- drag and drop file upload (just in case we are not on mobile)
- there is a colapsible piece above the chat input that shows prompt suggestions/options provided by the LLM agent. this is displayed as a column of rows. there is an up arrow on the right of each row. when clicked, the prompt is sent as the next message. otherwise when you click a row the prompt test is appended to the chat input.

3) session screen - files
a file explorer for the session
- this can be a demo placeholder for now.
- should be a collapsible tree view list of files and folders.
- there should be a button to refresh the file list.
- toggle button to show hidden files.

ability to upload files to the session.
ability to download files from the session.
ability to create new files and folders.
ability to move files and folders.
ability to delete files and folders.
ability to rename files and folders.
ability to view file contents - files are displayed as drawer that slides up to display the formated text of the file using codemirror.
- show breadcrumbs for the file path.
- there is a button to close the drawer.
- there is a button to save the file.
- there is a button to download the file.
- there is a button to delete the file.
- there is a button to rename the file.
- there is a button to move the file.
- there is a button to change to markdown rendering view.
- there is a button to change to csv rendering view in a datatable.

4) session screen - memories
This screen will be dedicated to the special CLAUDE.md file
- this will show a bulleted list of memories
- ability to add new memories.
- ability to edit memories.
- ability to delete memories.
- a button to display CLAUDE.md (opens file drawer rendering markdown)

5) session screen - settings
settings is divided into sections
4.1) Git Settings
- shows connected git repo using shadcn collapsible component.
- link to open the git repo in a new tab.
- shows git branch (using shadcn collapsible component) with a button to refresh the git branch.
- shows git user.name and user.email.
- shows git status.
- shows git log (using shadcn accordion component, with a button to refresh the git log)
- shows git diff (using shadcn accordion component)
4.2) Session Settings
- tabel for .env variables.
- ability to add/edit/remove .env variables.
4.3) Tool Settings
- shows all available MCP tools.
- ability to add/edit/remove MCP tools.
4.4) Permissions
- this will show the allow/deny settings for the session.
- there should be a toggle at the top for "dangerously enable all"
- there should be a table below with checkboxes for each tool to enable/disable. 
- there should be a toggle to filter the table by enabled or all.
- there should be a button to add new tool permissions.





---



# Mobile App for Remote LLM Agent Terminal - Design Plan

## Overview
A mobile app for controlling a remote LLM agent terminal (Claude Code Agent).

**App Name:** Convex Chef  
**Tech Stack:** Next.js 15.3 with App Router, shadcn, Tailwind v4  
**Target Platform:** Mobile phones (100% mobile-focused design)

## Core Features
- Light/dark mode on all pages
- Consistent header with logo and settings gear (except splash screen)

## App Structure

### 1. Splash Screen
Initial loading screen

### 2. User Authentication
- Clean login flow with GitHub OAuth

### 3. Home Screen
**Session Management Interface:**
- Grid or list layout of session cards
- Each session card includes:
  - Title
  - Description
  - Icon/image
  - Launch button
  - GitHub page link
  - Settings gear button
- Floating Action Button (FAB) to add new sessions

**Session Settings Modal:**
- Kill session (with confirmation)
- Delete session (with confirmation)
- Restart session (with confirmation)

### 4. Settings Screen
- Logout button
- User profile section
- SSH keys management section
- Organized into logical sections

## Backend Requirements
Store the following data:
- User authentication and session tokens
- Sessions (tracking terminal instances)
- Environment variables (encrypted)
- SSH keys (encrypted)
- User profiles (name, email, avatar)

## Session Interface

### Navigation
- Header button group or tab container for screen switching
- Swipe navigation between screens (preferred)

### Session Screens

#### 1. Terminal Screen (Default)
**Layout:**
- Top half: Formatted terminal window
- Bottom half: Tab container with 4 tabs

**Tabs:**
1. **Prompts Tab**
   - Cards with title, description, expandable accordion
   - Settings gear for add/edit/remove saved prompts

2. **Tasks Tab**
   - Empty placeholder for now

3. **Raw Tab**
   - Text area for terminal input
   - Send and Clear buttons
   - Common bash command buttons
   - Settings gear for saved bash commands

4. **Tools Tab**
   - Table of available MCP servers and their tools
   - Toggle to enable/disable each MCP server

#### 2. Chat Screen
**Chatbot Interface:**
- Executes: `bash claude -p "<prompt>" --dangerously-enable-all --session-id <session-id> --mcp-server <mcp-server-json>`

**Features:**
- Chat, voice, file, and image input
- Large send button
- Drag-and-drop file upload
- Collapsible prompt suggestions section
  - Column layout with rows
  - Up arrow to send prompt directly
  - Click row to append to chat input

#### 3. Files Screen
**File Explorer:**
- Collapsible tree view of files/folders
- Refresh button
- Toggle for hidden files

**File Operations:**
- Upload/download files
- Create files/folders
- Move, delete, rename items
- View file contents in slide-up drawer

**File Viewer (CodeMirror):**
- Breadcrumb navigation
- Action buttons:
  - Close, Save, Download
  - Delete, Rename, Move
  - Switch to Markdown view
  - Switch to CSV datatable view

#### 4. Memories Screen
**CLAUDE.md Management:**
- Bulleted list of memories
- Add/edit/delete memories
- View full CLAUDE.md file (opens in file drawer with Markdown rendering)

#### 5. Settings Screen

**5.1 Git Settings**
- Connected repo info (collapsible)
- External link to repo
- Git branch display with refresh
- User name and email
- Git status
- Git log (accordion with refresh)
- Git diff (accordion)

**5.2 Session Settings**
- Environment variables table
- Add/edit/remove .env variables

**5.3 Tool Settings**
- MCP tools management
- Add/edit/remove MCP tools

**5.4 Permissions**
- Allow/deny settings
- "Dangerously enable all" toggle
- Tool permissions table with checkboxes
- Filter toggle (enabled/all)
- Add new tool permissions button