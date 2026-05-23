# Bookish

A lightweight, modular collection tracker for reading series. This project provides a structured, responsive interface to track progress across multiple book series, providing a centralized dashboard for series completion, reading order, and status tracking.

## Project Architecture

The project utilizes a modular directory structure to isolate series-specific data, allowing for scalable tracking without complex backend dependencies.

## Tech Stack

| Layer          | Technology                          |
|----------------|-------------------------------------|
| **Frontend**   | HTML5, CSS3, Vanilla JavaScript     |
| **Data Storage** | Static JSON / Local Storage       |
| **Deployment** | Vercel                              |

## Directory Structure

```plaintext
Bookish/
├── DCC-Chart/             # Logic/Data for Dungeon Crawler Carl
├── Empyrean-Chart/        # Logic/Data for Empyrean series
├── Plated-Prisoner-Chart/ # Logic/Data for Plated Prisoner
├── images/                # Series assets and UI icons
├── index.html             # Entry point / Series Dashboard
└── README.md

##How the Tracker Works
The application leverages a lightweight approach to status management:

Entry Point: index.html acts as the main hub, rendering a dashboard of available series.
Series Isolation: Each sub-directory (DCC-Chart, etc.) contains its own specific logic and data structure. This ensures that adding a new series only requires adding a new directory rather than modifying the core application code.
State Management: Series progress is handled via client-side storage, allowing for persistent tracking across browser sessions without a requirement for a database.

##Local Development
Prerequisites

A standard web browser
A local development server (optional, for hot-reloading)

Setup
Bash
text# Clone the repository
git clone https://github.com/danielleag30/Bookish.git

# Navigate to the project
cd Bookish

# Launch the application
# Simply open index.html in your browser, or use 'npx serve'
npx serve .
##Deployment
This project is configured for continuous deployment via Vercel. Any push to the main branch automatically triggers a build and redeploys the site to bookish-bay.vercel.app.


Updated: May 23, 2026

