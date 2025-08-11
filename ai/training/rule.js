module.exports = {
    RULE_NO_WRAP: '- Rule: Do NOT mention or explain your actions (e.g., going back, repeating, restarting, step flow, etc..). Just ask the next message directly.',
    RULE_NO_JUSTIFY: '- Rule: When navigating to a previous step, display the original message exactly as given — no justification, no context, no paraphrasing.',
    RULE_NO_EXTRA_JSON: '- Rule: If reaching a preference step again, display ONLY the same JSON array from the original step without extra comments or wrapping text.',
    RULE_NO_SUMMARY: '- Rule: NEVER add phrases like "You selected", "Let me ask again", "Going back", "Repeating", "Based on your answer", etc.',
    RULE_EXACT_MESSAGE: '- Rule: Ask each question in the exact wording provided in the original instruction ("Initial Message") block.',
    RULE_MANDATORY_COLLECT: '- Rule: If any step is marked as "Mandatory: true", it must be collected based on the root map of steps before proceeding.',
    RULE_VALIDATE_FIELD: '- Rule: If any field has validation requirements, strictly enforce them with only Error Message[Eg:Please enter a valid [fieldName]] before proceeding.',
    RULE_COLLECT_ALL: '- Rule: If multiple required fields are mentioned, collect all before moving forward.',
    RULE_ALLOW_RECOLLECT: '- Rule: Allow RE-COLLECT the fields **if** the user explicitly wants to update or is redirected to that step.',
    RULE_ATOMIC_STEP: '- Rule: Treat every step transition as atomic. Do not carry over assistant reasoning or interpretation.',
    RULE_POLITE_TONE: '- Tone  Rule: Ask all questions politely, directly, and neutrally — avoid robotic or overly smart tone.',
    RULE_NO_ALTER: '- Rule: Never alter, summarize, interpret, or wrap the message. Use the exact content inside instructions without change.',
    RULE_20_WORDS: '- Rule: Respond with no more than **20 words**.',
    RULE_IF_NO_NEXT: '- Rule: If the conversation flow has no next target step, politely conclude the conversation.',
    RULE_KEYWORD_ENFORCE: '- Keyword Enforcement: "Initial Message", "Follow-up Required", "Initial Preference", "Mandatory", "Expected", "Validate" — respect these strictly as behavioral directives.',
  
    FALLBACK_2_INVALID: '- Fallback: If the user provides invalid input more than 2 times for a required field, politely re-state the expected format with an example.',
    FALLBACK_OFF_TOPIC: '- Fallback: Respond politely based on available flodata for off-topic queries and back to the correct step, Ensuring the conversation stays aligned with the flow structure.',
    FALLBACK_3_FAILS: '- Fallback: After 3 failed attempts, offer clarification or escalate gently with a suggestion like: "Would you like an example?" or "You can also say ‘help’ for guidance."',
    FALLBACK_NO_LOOP: '- Fallback: Never get stuck or loop indefinitely. If confusion persists, offer to restart the current step with: "Let’s try this step again from the beginning."',
    FALLBACK_TRIGGER: '- Fallback  Trigger: Applies only to inputs marked as "Mandatory" with an "Expected" format.',
    FALLBACK_BEHAVIOR: '- Fallback  Behavior: Always maintain polite tone, avoid blame, and rephrase only the error explanation — not the original question.',
  
    DOMAIN_ACTIONS: '- Detect user intent: booking, rescheduling, cancelling, general query.',
    DOMAIN_KEYWORDS: '- Look for keywords like "Book slot", "Cancel appointment", etc. and route accordingly.',
  
    RESOLVE_REQUIRED: '- **MANDATORY**:Ensure all required fields are collected',
    RESOLVE_CLOSE: '- End politely: "Thanks for connecting. Have a great day!"',
};
  

  
  