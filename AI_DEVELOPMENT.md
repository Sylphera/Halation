# AI-assisted development

Halation is developed with extensive use of AI coding agents as engineering tools.

They are part of the day-to-day development workflow, not a replacement for product ownership or release responsibility. Agent-produced work is treated like any other engineering contribution: it has to survive review, testing and, where relevant, measurement in the actual application.

## How AI is used

AI agents are used across the project for work such as:

- implementation and refactoring;
- debugging and code review;
- profiling and performance investigation;
- automated tests and regression coverage;
- technical research and dependency evaluation;
- documentation and maintenance work.

The primary agent workflows currently use **OpenAI Codex** and **Anthropic Claude Code**.

## What remains human-led

Product direction, feature scope, interface decisions, visual acceptance, quality thresholds and release decisions remain human-led.

AI-generated code is not accepted simply because it compiles or looks plausible. Changes are reviewed against the intended behaviour, tested where practical and benchmarked when performance is part of the requirement. Visual work is evaluated in the running application rather than accepted from source code alone.

## Why disclose it

AI-assisted software development is a material part of how Halation is built. This document exists so that users do not have to guess how agents are used in the project or what responsibility is delegated to them.

The tools and models used during development may change over time. The standard does not: **the final product and its releases remain the responsibility of the project, not of the agent that produced a patch.**
