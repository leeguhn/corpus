"""Shared constants for snippets and pipeline: topics, roles, and system prompt."""
from __future__ import annotations

SYSTEM_PROMPT = (
    "Ramble as if you are a {role}."
    " Do NOT include internal thoughts, analysis, chain-of-thought, reasoning steps, or any meta-commentary. "
    "Do NOT include channel markers like <|channel|>analysis. Do NOT use asterisks (*) or markdown-like formatting. Output only the final snippet as plain text."
)

# Topics of daily life
topics = [
    "waking up", "breakfast", "commute", "work", "lunch",
    "errands", "hobbies", "dinner", "relaxing", "social interactions",
    "morning routine", "shower", "coffee", "emails", "meetings",
    "brainstorming", "reading", "studying", "gym", "exercise",
    "grocery shopping", "cooking", "baking", "laundry", "dishes",
    "bedtime", "naps", "pet care", "parenting", "childcare",
    "teaching", "tutoring", "shopping", "budgeting", "paying bills",
    "gardening", "yard work", "walking the dog", "public transit", "traffic",
    "parking", "bike ride", "park", "library", "cafe",
    "nightlife", "movie night", "streaming", "gaming", "sports",
    "volunteering", "DIY", "home repairs", "appointments", "dentist",
    "doctor visit", "prescriptions", "packing", "unpacking", "travel planning",
    "seasonal chores", "study group", "group project", "networking", "interview prep",
    "small talk", "flirting", "date night", "family time", "chores",
    "celebration", "holidays", "home office", "commute woes", "free time"
]

# Roles to rotate
roles = [
    "teenager", "middle-class adult", "academic researcher",
    "student", "office worker", "artist",
    "retiree", "parent", "single parent", "chef", "barista",
    "nurse", "doctor", "engineer", "programmer", "designer",
    "salesperson", "manager", "ceo", "intern", "graduate student",
    "postdoc", "librarian", "teacher", "professor", "scientist",
    "activist", "musician", "actor", "writer", "journalist",
    "blogger", "social worker", "counselor", "psychologist", "therapist",
    "farmer", "gardener", "handyman", "mechanic", "driver",
    "taxi driver", "bus driver", "pilot", "flight attendant", "waiter",
    "waitress", "baker", "photographer", "filmmaker", "influencer",
    "entrepreneur", "founder", "investor", "accountant", "lawyer",
    "paralegal", "student-athlete", "coach", "personal trainer", "athlete",
    "consultant", "analyst", "it support", "sysadmin", "security guard",
    "police officer", "firefighter", "paramedic", "civil servant", "policy maker",
    "diplomat", "ngo worker", "small-business owner", "retail worker", "construction worker"
]
