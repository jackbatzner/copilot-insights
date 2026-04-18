# Prompting Best Practices — Curated Resources

A collection of official guides, research, and community resources on prompt engineering for AI coding assistants. These are the sources behind Copilot Insights' scoring heuristics and coaching nudges.

## Official Provider Guides

| Source | Guide | Key Takeaways |
|--------|-------|---------------|
| **GitHub** | [Best practices for using GitHub Copilot](https://docs.github.com/en/copilot/get-started/best-practices) | Start general then get specific; provide examples; break complex tasks into steps; avoid ambiguity |
| **GitHub** | [Prompt engineering for Copilot Chat](https://docs.github.com/en/copilot/concepts/prompting/prompt-engineering) | Include file paths, constraints, and examples in prompts |
| **Anthropic** | [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Define success criteria; separate instructions/context/output; one good example beats five adjectives |
| **OpenAI** | [Prompt engineering guide](https://platform.openai.com/docs/guides/prompt-engineering) | Write clear instructions; provide examples; supply context; use delimiters |
| **Google** | [Prompt engineering overview](https://cloud.google.com/discover/what-is-prompt-engineering) | PTCF framework: Persona · Task · Context · Format |

## What We Check (and Where It Comes From)

| Quality Signal | Score Bonus | Sources |
|----------------|-------------|---------|
| **File references** — mentions specific files or paths | +12 | GitHub ("avoid ambiguity"), Anthropic ("be explicit") |
| **Constraints** — uses "must", "don't", "only", "avoid" | +10 | GitHub ("set boundaries"), Anthropic ("list constraints"), Google ("explicit instructions") |
| **Acceptance criteria** — "should return", "expects", "when...then" | +10 | Anthropic ("define success criteria"), Google ("explicit goal"), OpenAI ("specify output") |
| **Context / reasoning** — "because", "so that", "in order to" | +8 | Anthropic ("provide context"), OpenAI ("supply relevant context"), Google ("attach background") |
| **Examples** — "for example", "e.g.", "such as", sample I/O | +6 | All four providers explicitly recommend few-shot examples |
| **Output format** — "as JSON", "markdown table", "bullet points" | +5 | Anthropic ("structured output"), Google ("set output format"), OpenAI ("ask for structured outputs") |
| **Step structure** — numbered steps, "first...then" | +5 | GitHub ("break complex tasks"), Google ("stepwise reasoning"), OpenAI ("multi-step tasks") |
| **Technical specifics** — error codes, HTTP methods, line numbers | +5 | GitHub ("be specific"), all providers emphasize precision |

## Academic Research

| Paper | Authors | Key Finding |
|-------|---------|-------------|
| [A Systematic Survey of Prompt Engineering in Large Language Models](https://arxiv.org/abs/2402.07927) | Sahoo et al. (2024) | Structured prompts with clear context and specificity significantly improve model output quality |
| [Comprehensive Taxonomy of Prompt Engineering](https://link.springer.com/article/10.1007/s11704-025-50058-z) | Liu et al. (2025) | Four dimensions: profile/instruction, knowledge, reasoning/planning, reliability |
| [The Prompt Report](https://www.promptingguide.ai/papers) | Schulhoff et al. (2024) | Systematic survey of 58+ prompting techniques with evaluation frameworks |

## Community Resources

- [Prompt Engineering Guide](https://www.promptingguide.ai/) — Comprehensive community wiki with techniques, papers, and model-specific tips
- [Anthropic Cookbook](https://platform.claude.com/cookbook/) — Practical ready-to-use examples for Claude
- [OpenAI Cookbook](https://cookbook.openai.com/) — Example code and guides for GPT models
- [GitHub Copilot CLI Best Practices](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices) — Terminal-specific prompting tips

## The Universal Checklist

Based on consensus across all major providers and research:

1. **Be specific** — Name the file, function, endpoint, or module
2. **Set constraints** — "don't modify tests", "use TypeScript", "only change src/api/"
3. **Define done** — What should the output look like? What behavior proves it works?
4. **Explain why** — Context helps the agent make better architectural decisions
5. **Show examples** — One good example beats five paragraphs of description
6. **Request a format** — "as JSON", "in a markdown table", "bullet points"
7. **Break it down** — Complex tasks should be numbered steps, not one giant prompt
8. **Be proactive** — State preferences upfront instead of correcting after the fact
