# Token benchmark — ollama-cloud/gpt-oss:120b, 7 tasks × 2

| Engine | Avg input tokens / task | vs mali-before | Uncached input | Output | Quality | Errors |
|---|---:|---:|---:|---:|---:|---:|
| opencode | 72,314 | 72% | 8,330 | 729 | 94% | 0 |
| mali-before | 42,025 | 0% | 4,057 | 844 | 98% | 1 |
| mali-after | 28,849 | -31% | 5,228 | 770 | 93% | 2 |

## Per task

| Task | opencode | mali-before | mali-after |
|---|---:|---:|---:|
| csv-summary | 59,693 tok · 100% | 32,740 tok · 100% | 23,335 tok · 100% |
| fix-bug | 101,308 tok · 100% | 64,630 tok · 100% | 39,090 tok · 100% |
| crm-lookup | 44,974 tok · 100% | 25,978 tok · 100% | 22,901 tok · 100% |
| crm-create | 51,524 tok · 100% | 25,977 tok · 100% | 23,192 tok · 100% |
| crm-to-files | 127,606 tok · 61% | 61,866 tok · 89% | 41,844 tok · 50% |
| handbook-qa | 68,930 tok · 100% | 50,307 tok · 100% | 34,603 tok · 100% |
| thai-summary | 52,167 tok · 100% | 32,680 tok · 100% | 16,982 tok · 100% |
