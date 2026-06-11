---
title: 'AI and Cognitive Decline: Every Study Worth Knowing'
publishDate: 'June 11 2026'
updatedDate: 'June 11 2026'
faq:
    - question: 'Is there scientific evidence that AI makes you dumber?'
      answer: 'There is converging evidence that heavy AI use reduces the cognitive work you do - and that this shows up as weaker memory, lower comprehension, and less critical thinking on the tasks you offload. The MIT EEG study, the Anthropic learning study, and two large critical-thinking surveys all point the same direction. "Dumber" overstates it: the effects are task-specific and appear reversible.'
    - question: 'What did the MIT "Your Brain on ChatGPT" study actually find?'
      answer: 'Fifty-four participants wrote essays - with ChatGPT, with Google search, or unassisted - wearing EEG caps. The ChatGPT group showed the weakest neural connectivity across regions involved in planning, integration, and recall, and most could not quote a sentence from the essay they had just written. The authors describe the pattern as accumulated cognitive debt.'
    - question: 'Do AI coding assistants make developers worse at programming?'
      answer: 'The best current evidence says they impair learning and comprehension while often not delivering the speed people feel. An Anthropic study found 17% lower comprehension scores when learning a new library with AI help, with debugging hit hardest. A METR randomized trial found experienced developers were 19% slower with AI tools while believing they were faster.'
    - question: 'Are the effects of AI on the brain permanent?'
      answer: 'Nothing in the current research suggests permanent damage. The documented mechanisms are skipped practice and disuse, not injury. The MIT data suggests effects linger after heavy use - participants who switched from ChatGPT to writing unassisted still underperformed - but disuse-based decline rebuilds with use.'
seo:
    title: 'AI and Cognitive Decline: Every Study Worth Knowing (Living Review)'
    description: 'A living review of the research on AI and cognitive decline: MIT, Anthropic, METR, Microsoft + CMU - methods, sample sizes, findings, and caveats.'
    pageType: article
---

*Does using AI degrade your thinking? The short answer from the research so far: heavy AI use measurably reduces the cognitive work you do, and the skipped work shows up as weaker recall, lower comprehension, and less critical thinking on the offloaded tasks. The effects look real, task-specific, and - importantly - driven by disuse rather than damage. This page collects every serious study on the question, with methods and caveats, and is updated as new research lands.*

I maintain this list because the discourse runs on headlines ("ChatGPT rots your brain!") and the headlines run on studies almost nobody reads. Here is what the studies actually say.

## The studies at a glance

| Study | Year | Method | Sample | Key finding |
| --- | --- | --- | --- | --- |
| [MIT Media Lab - *Your Brain on ChatGPT*](https://www.media.mit.edu/publications/your-brain-on-chatgpt/) | 2025 | EEG during essay writing, 3 groups (ChatGPT / Google / unassisted), 4 sessions | 54 participants | Weakest neural connectivity in the ChatGPT group; most couldn't quote their own essay; "cognitive debt" persisted after switching to unassisted writing |
| [Anthropic - AI assistance and skill formation](https://www.infoq.com/news/2026/02/ai-coding-skill-formation/) | 2026 | Controlled experiment: developers learning a new library with vs. without AI | Developers (controlled trial) | **-17%** on comprehension tests with AI assistance; largest gap in debugging; no statistically significant productivity gain |
| [METR - Early-2025 AI on experienced developers](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) | 2025 | Randomized controlled trial on real open-source tasks | 16 experienced maintainers, 246 tasks | Developers were **19% slower** with AI tools while believing AI had sped them up |
| [Microsoft Research + CMU - GenAI and critical thinking](https://dl.acm.org/doi/full/10.1145/3706598.3713778) | 2025 | Survey of knowledge workers using GenAI weekly, 936 first-hand task examples | 319 knowledge workers | Higher confidence in GenAI predicts **less** critical thinking; higher self-confidence predicts more; thinking shifts from doing to verifying |
| [Gerlich - AI tools and critical thinking](https://www.mdpi.com/2075-4698/15/1/6) | 2025 | Survey + interviews, mediation analysis | 666 participants (UK) | Significant negative correlation between AI tool use and critical-thinking scores, mediated by cognitive offloading; strongest in younger users |
| [Fan et al. - *Beware of metacognitive laziness*](https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13544) | 2024 | Lab experiment: learning with ChatGPT vs. other supports | University students | ChatGPT improved essay scores but reduced planning, monitoring, and self-evaluation - better output, worse learning |

## What each study actually shows

### MIT Media Lab: the EEG study everyone misquotes

Kosmyna and colleagues had 54 people write SAT-style essays across four sessions - one group with ChatGPT, one with Google search, one with nothing - while wearing EEG caps. The ChatGPT group showed the weakest connectivity across brain regions involved in planning, integration, and memory; the unassisted group the strongest; search in between. The detail that travels furthest: asked to quote a sentence from the essay they had *just written*, most ChatGPT users couldn't.

The caveat the headlines drop: it's a preprint, the sample is small, the task is essay writing, and the authors explicitly reject the "brain rot" framing - see [why the distinction matters](/glossary/ai-brain-rot/). What the study supports is narrower and more useful: offloaded work doesn't get encoded, and the deficit ([cognitive debt](/glossary/cognitive-debt/)) outlasts the session.

### Anthropic: -17% comprehension, debugging hit hardest

Anthropic's study (published February 2026) tested developers learning an unfamiliar library with and without AI assistance. The AI group scored 17% lower on comprehension, and the gap was widest for debugging - mechanically, because AI fixes interrupt the encounter-diagnose-resolve loop that builds intuition. Control participants hit a median of three errors per session; AI users hit one. The productivity gain, meanwhile, wasn't statistically significant: the trade was comprehension for speed that largely didn't materialize.

That an AI lab published this about its own product category is worth something. The mechanism matches what the broader literature calls [skill atrophy](/glossary/ai-skill-atrophy/).

### METR: slower, but feeling faster

METR ran a proper randomized trial - 16 experienced open-source maintainers, 246 real tasks on their own repositories, AI tools allowed or not by random assignment. With AI, developers took 19% *longer* - while estimating that AI had made them faster. The point here isn't "AI bad"; later tools and other populations may show real speedups. The point is the perception gap: if your sense of being faster is wrong, your sense of "and my skills are fine" deserves an audit too.

### Microsoft + CMU: trust the AI, think less

A survey of 319 knowledge workers who use generative AI at least weekly, with 936 concrete examples of AI-assisted tasks. The headline result is the confidence cross-over: the more people trusted GenAI, the less critical thinking they reported; the more they trusted their own skills, the more. Critical thinking didn't vanish - it shifted from producing work to verifying the AI's work. Whether verification skills survive when production skills fade is exactly the open question - and the daily experience of it is what [automation complacency](/glossary/automation-complacency/) describes.

### Gerlich: the correlation study with the mediator

Gerlich surveyed and interviewed 666 people in the UK and found a significant negative correlation between AI tool use and critical-thinking performance - mediated by [cognitive offloading](/glossary/cognitive-offloading/), strongest in younger participants, buffered by education. It's correlational: people with weaker critical thinking might simply lean on AI more. But the mediation analysis is what makes it interesting - the data fits "AI use → more offloading → less critical thinking" better than the reverse.

### Fan et al.: better essays, worse learners

The study that named [metacognitive laziness](/glossary/metacognitive-laziness/). Students learning with ChatGPT produced better essays than peers with other supports - while doing measurably less planning, monitoring, and self-evaluation. The output improved; the durable learning didn't. For anyone whose job is learning new systems weekly (that is: developers), this is arguably the most relevant result on the list.

## What the evidence does *not* show

Honesty section, because a review that only collects scary results is marketing:

- **No study shows brain damage.** Every documented mechanism is skipped work or disuse - reversible categories.
- **No study shows AI users perform worse at everything.** Effects are task-specific: the offloaded skill suffers, others don't.
- **The samples are small and the field is young.** 54 people, 16 developers, preprints. Direction is converging; effect sizes are not settled.
- **None of this is an argument against using AI.** It's an argument for choosing deliberately what to offload - storage, boilerplate - and what to keep practicing: diagnosis, comprehension, recall.

## Update log

- **June 11, 2026** - initial version: MIT, Anthropic, METR, Microsoft + CMU, Gerlich, Fan et al.

Know a study that belongs here? [Tell me](/about/) - the whole point of a living review is that it stays alive.
