# usage-meter

<img width="1440" height="912" alt="Screenshot 2026-10-31 at 17 38 06" src="https://github.com/user-attachments/assets/82f76ec3-2e58-488b-84db-3d4c5ef2b92d" />

A Claude Code mod that adds a **Usage** pane showing how much of your Claude subscription's limits you have left:

- **Session** (5-hour window) and **Weekly** (7-day window), each as a big "% left" figure
- a bar with the remaining share filled and the used share hatched
- the time until each window resets
- a white marker at the **even pace** point: where "% left" would be if usage were spread evenly across the window, with a note saying how far ahead or behind it you are

Below the meters, the pixel Claude crab reacts to the tightest window: happy and scuttling when you're on or ahead of pace, sweating when you're more than 5% behind, and dozing off when under 10% is left.

It updates after every reply. Running `/usage-meter` fetches fresh figures right away (the same ones `/usage` shows), and the pane fetches again every 5 minutes on its own. The pane and the command both say when the figures were last updated, and if the usage endpoint rate-limits, they say when it will retry (15 minutes, or longer if it asks). The last figures are saved, so a new session or a reload shows them right away. The reset countdown ticks every minute. Figures need a Claude subscription. In a terminal the bar is drawn in text, with `│` as the pace marker.

## Usage

Run `/usage-meter` to open the pane; it also replies with a small crab and the current mood. The pane does not open on its own.

The mod registers `/usage-meter` once a chat has started. To also see it in the desktop app's command menu before a chat starts, add a personal command file at `~/.claude/commands/usage-meter.md`; the mod answers it, so its text never reaches Claude:

```markdown
---
description: Show usage left and time to reset in a pane
---
Open the usage-meter pane.
```

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install usage-meter --marketplace Jesus-QC/usage-meter
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install usage-meter --marketplace Jesus-QC/usage-meter
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Jesus-QC/usage-meter`, then **Add plugin**.

This repository is private: installing it needs read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).
