# Blackwood Colony

A Next.js and TypeScript overhead ant foraging simulation powered by Canvas 2D.

```sh
npm install
npm run dev
```

Then visit `http://localhost:3000`.

## Deployment

Pushes to `main` build `ghcr.io/8exgh/simant:latest` and dispatch deployment to
the Server16 self-hosted runner. The container maps host port **3016** to port
3000. Deployment orchestration lives in the `8exgh/devops` repository.

Workers discover nearby food, return it to the nest, and deposit decaying pheromone trails that other workers can follow. Click a worker to take control, click the ground to move it, double-click a pellet to collect it, and click the nest entrance to deliver it.
