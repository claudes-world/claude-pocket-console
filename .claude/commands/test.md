---
allowed-tools: Bash(echo:*), Bash(cat:*), Bash(export:*), Bash(echo $:*)
description: Testing arguments as array.
---
boom

!`export TEST_ARGS="$ARGUMENTS"`

First, say hello !`cat test.txt`

Please repeat the following sentence word for word:

I love eating !`echo -n "farts"` and poo poo

Here is my !`cat "$TEST_ARGS"`

hehe $ARGUMENTS haha...