"""Small statistics helpers used by the weekly report."""


def mean(values):
    return sum(values) / len(values)


def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle]


def spread(values):
    return max(values) - min(values)
