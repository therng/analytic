# Contributing to Analytic

First off, thanks for taking the time to contribute!

## Development Setup

1. Make sure you have Node.js 20+ installed.
2. Install dependencies: `npm install`
3. Make sure Docker is running to host the local database.
4. Run migrations: `npx prisma migrate dev`
5. Start development server: `npm run dev`

## Code Style

- Use `eslint` to verify your code follows the style guidelines: `npm run lint`.
- Make sure to add relevant comments if the business logic is complex.

## Pull Requests

1. Fork the repo and create your branch from `main`.
2. Ensure any install or build dependencies are removed before the end of the layer when doing a build.
3. Update the `README.md` with details of changes to the interface.
4. Issue that pull request!
