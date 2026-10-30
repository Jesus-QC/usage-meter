# usage-meter

A Claude Code mod that adds a **Usage** pane showing how much of your Claude subscription's limits you have left:

- **Session** (5-hour window) and **Weekly** (7-day window), each as a big "% left" figure
- a bar with the remaining share filled and the used share hatched
- the time until each window resets
- a white marker at the **even pace** point: where "% left" would be if usage were spread evenly across the window, with a note saying how far ahead or behind it you are

It updates after every reply and ticks once a minute between replies. Figures appear after the first reply on a Claude subscription. In a terminal the bar is drawn in text, with `│` as the pace marker.

## Usage

Run `/usage-meter` to open the pane. It does not open on its own.

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
