---
title: I read my own commits like a stranger
publishDate: 'June 4 2026'
excerpt: An MIT study found 83% of ChatGPT users could not quote their own essay. The same started happening with my code.
tags:
  - ai
  - cognition
  - programming
seo:
  title: I read my own commits like a stranger
  description: '83% of ChatGPT users could not quote their own essay. The same started happening with my code - notes on cognitive debt from AI coding.'
---

> When MIT researchers put EEG caps on people writing essays with ChatGPT, **83%** of the AI group could not quote a single sentence from the essay they had just finished. The number stayed abstract to me until I opened my own repo and did not recognize the code on screen.

## What happened with me?

Yesterday I opened my project repo on github to fix one small bug. The bug was not critical, it was just wrongly set weights for the ranking system. I knew the architecture of my own code perfectly, where each file is and how it works. But that did not stop me from getting stuck for a minute, maybe two, reading the code of a file that I wrote with my own hands, but at the same time it felt like somebody else's commit.

At first I thought maybe it really wasn't me who wrote it, but these 28 lines of code, I was exactly the author. `egorthinks "ranking system upd weight", last week`. It was written well. If I was a team lead for myself, I would for sure praise the elegance and the simplicity of the implementation. But. I did not remember that it was me who wrote this code.

I scrolled through this code and read it like, probably, authors of original books read their own translations. The architecture and the idea of the implementation are mine, but damn, I did not recognize the lines of this code.

Maybe you will say that I'm just a dumb vibecoder or something like that. I thought about myself the same way, because before AI this did not happen. I really thought the problem was in me, because nobody else from my friends and colleagues talked about it.

Of course, as it turned out later, nobody said anything because, just like me, they thought the problem was in themselves. I found this out after a small survey of seven of my colleagues (4 confirmed, 2 more yes than no, and 1 denied it, but he really writes everything by hand and hates AI). It does not count as a scientific paper, but it lets me make a conclusion that the problem exists. And anyway, the scientific papers already exist.


## What the MIT study found

While researching this problem I came across a paper from June 2025 in which a team led by Natalia Kosmyna from MIT Media Lab put EEG helmets on 54 people and asked them to write an essay. They split them into three groups: the first group wrote without help, the second with Google, the third used ChatGPT. One specific number caught me in this work, 83%. **83% of people from the third group could not reproduce a single quote from the essay they wrote a few minutes ago**. From the same 17% who remembered at least something, they could not reproduce the text word for word. Meanwhile in the groups without AI the failure rate was only 11%.

The electroencephalography data showed the same picture as the oral survey of the participants. The brain of the no-AI group showed the strongest and most branched neural networks while writing the essay. The Google group was in the middle. And the ChatGPT group had the weakest connectivity, especially in the alpha and beta ranges, which are especially connected to internal attention in the human brain.

The paper is still a [preprint on arxiv](https://arxiv.org/abs/2506.08872), it (as of 27.05.2026) has not passed peer review yet. There is also criticism of the sample and of the methodology of the EEG research. But even with all the criticism of the paper and the problems with EEG research, you can take the results seriously just from the oral surveys alone. When almost everyone (83 percent) of the people using AI could not give an answer about their own text, this is exactly the problem that me and my friends saw on ourselves with coding.


## So why is simply accepting changes not the same as writing them by hand?

I think this happens on the lowest motor level. Our whole life we learned to write, on paper, on screen, no difference. Our thought always went into matter through our hands perfectly. When you write code you already remember the next lines of code in advance, because they were already there and you just reinforced this memory by pressing the keyboard keys, confirming the correctness of the action in your thoughts. You can ask *"but what about talking?"*. And I can ask back *"how many conversations from today do you remember compared to messages in the messenger?"*. I can't answer for you, but for myself I can answer for sure. Conversations I remember 50/50, but what I wrote I remember almost 9 out of 10.

Meanwhile when writing code with AI, whether it's simple autocomplete or an agent like claude code, the motor part of the subconscious accepting and saving the code in the head does not work. It's a simple yes/no accept loop like when updating packages (does anyone even read what the terminal programs ask us to give our consent to?), only with your code.


What I described above (you remember information stronger when you create something, than when you only recognize it) is called the generation effect. [Slamecka and Graf showed it on word pairs in 1978](https://doi.org/10.1037/0278-7393.4.6.592). It was not connected to code, but the shape of the result matches what me and my colleagues feel and what the researchers at MIT caught.

![Two columns divided by a vertical line. Left column labeled 'typed by me': a brain with four arrows pointing down to a solid-bordered code block. Right column labeled 'accepted from Claude': a smaller brain with one thin arrow pointing down to a dashed-bordered code block.](../../assets/images/blog/stranger/1.png)
*Same code, two different traces left in my head.*

## Memorization with agent and manually

After this kind of thinking I started to pay attention to which files I can move freely in and which I can't. And I won't keep the intrigue, the ones I moved in calmly without search or git blame are the ones I typed by hand. For example, in the same repo that I started this article with there is a file for working with graphs. There was one function in it that claude code constantly messed up, because of which the system broke. I fixed it by hand (without going into details, the problem was in one line) and this exact line I remember a month later. And meanwhile in the same file there is a function, already 40 lines, that I read like 6 times but still did not memorize this code, it's a stranger to me.

## The taxi driver and the GPS

Talking about this problem, I can't not mention a study, even if it's not about AI (which actually does not matter for the human brain, for it any simplification is a simplification). In 2000 a group led by [Maguire group from University College London](https://doi.org/10.1073/pnas.070039597) did brain scans of licensed London taxi drivers, who memorize around 26000 streets to get a license. Their posterior hippocampus (the brain area responsible for building spatial maps) was noticeably bigger than in the control group of non-taxi-drivers, and it noticeably grew with the years. Later studies on active GPS users showed roughly the opposite dependency: when you trust the route building to the device, your own route builder in the head stops working and developing. I will still note that the studies with the GPS group are not as clear as with the taxi drivers, but the direction stays the same. Almost every day we use different programs for building routes, everyone to their own taste and color, but we give up the more complex one at the start but more reliable one in our head. Same with code, and everything else when you delegate it to AI.

## Main point that worries me

But the main point that worries me the most is the habit of trusting AI and losing your own opinion. Before I did not notice this in myself, but now for any reason and without one I consult with claude or just delegate part of the routine tasks to him. I'm not saying delegating is bad, but mindless trust is bad. Every time you let AI work alone, even without copilot mode, it's another coin in the piggy bank of future problems, which can be either not scary (just longer to read the code) or simply getting banned on HN or simply delete an important component without the possibility of recovery *(anything can happen)*.

## Learning less while finishing faster (Shen & Tamkin)

In January 2026 researchers from anthropic (yes, trusting 100% the ones who sell us AI is not the best idea, but again, we are looking exactly at the vector of the result!), [Judy Hanwen Shen and Alex Tamkin](https://arxiv.org/abs/2601.20245), published their research in which they looked at the question from a different angle. They offered developers to learn a new asynchronous python library (trio) which they did not know yet, using AI or without it, and then tested them on understanding concepts, reading code and debugging. The group that used AI showed about **17 percent** lower results on the comprehension test. They finished the work faster but understood worse. The cornerstone moment for me in this paper is the 6 marked patterns of AI usage, and three of them, as the researchers note, preserved people's skills even with using an agent. These patterns assumed constant interaction with what the LLM put out instead of simply accepting the result. This is roughly how we should work with AI. (PS in the remaining usage patterns people just copied and pasted mindlessly, this is a bad option, don't do this)

## My thoughts on this.

Right now I wrote down a rule that I have to follow on a napkin (*the only paper I had on the desk, and on the site make do with a work of AI, I was ashamed to post photos of my napkins on the web*): everything that touches the core logic is mine, don't give to any AI even if it's claude Mythos. The rest, templates, tests, glue, scripts, I give to the agent.

![A circular hand-drawn diagram. Center circle labeled 'core logic - I type this'. Four outer circles connected by inward-pointing arrows along wavy lines: 'tests' top left, 'scripts' top right, 'glue' bottom left, 'config' bottom right.](../../assets/images/blog/stranger/2.png)
*The line I am drawing this month. It might move.*


## To sum up.

That pause with my "own" code, which made me write this article and start this blog in general, was not a small thing at all. The guys from MIT called it cognitive debt. The word debt describes it as well as possible. Debt first piles up, and only after that you get problems. Same here.

I wrote this article so that both me and you-the-reader next time would notice this debt earlier and could pay it off. Of course I can't tell you what exactly to do, but I can try to give answers why this happens.

**PS I can't insist, but I would be very happy if you subscribed to my newsletter below, this way you'll learn more about this problem and support me. Thanks!**

## Sources

- [Kosmyna, N., Hauptmann, E., Yuan, Y. T., Situ, J., Liao, X. H., Beresnitzky, A. V., Braunstein, I., & Maes, P. (2025). Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task. arXiv:2506.08872.](https://arxiv.org/abs/2506.08872)
- [Slamecka, N. J., & Graf, P. (1978). The generation effect: Delineation of a phenomenon. *Journal of Experimental Psychology: Human Learning and Memory*, 4(6), 592-604.](https://doi.org/10.1037/0278-7393.4.6.592)
- [Maguire, E. A., Gadian, D. G., Johnsrude, I. S., Good, C. D., Ashburner, J., Frackowiak, R. S. J., & Frith, C. D. (2000). Navigation-related structural change in the hippocampi of taxi drivers. *Proceedings of the National Academy of Sciences*, 97(8), 4398-4403.](https://doi.org/10.1073/pnas.070039597)
- [Shen, J. H., & Tamkin, A. (2026). How AI Impacts Skill Formation. arXiv:2601.20245.](https://arxiv.org/abs/2601.20245)
- [Anthropic: How AI assistance affects coding skills.](https://www.anthropic.com/research/AI-assistance-coding-skills)
- [Becker, J., Rush, N., Barnes, B., & Rein, D. (2025). Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity. arXiv:2507.09089.](https://arxiv.org/abs/2507.09089)
