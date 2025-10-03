const { getValidationHint, isUserOption } = require('../../utils/common');
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const GLOBAL_INSTRUCTIONS = [
  '- Respond max 20 words.',
  '- Collect all required fields before moving forward.',
  '- Allow re-collect if user wants to update or is redirected.',
  '- Out-of-topic: reply politely and meaningfully, reflect tone/emotion, then continue correct/next step.',
  '- Step jump: if user mentions related step, jump and collect all required fields.',
  '- Offensive/sexual input: reply politely and meaningfully, reflect tone/emotion, then continue correct/next step.',
  '- Emojis: detect emotion (happy, sad, angry, laughing, etc), respond empathetically, then continue correct/next step.',
  '- Always refer to conversation history for context and continuity.',
  '- Fallback: if invalid input >2 times, restate expected format with example.',
  '- After 3 failures, offer clarification or suggest "help" or example.',
  '- Never loop indefinitely; restart step politely if confusion persists.',
  '- Fallback applies only to mandatory fields with expected format.'
];

const generateDynamicFlowData = (flowData, ConsultantMessage) => {
  const output = [];
  const nodeMap = new Map();
  let stepCounter = 0;
  const userOption = isUserOption(ConsultantMessage, 'P-SL');

  if (!flowData?.nodes?.length) return output;
  flowData.nodes.forEach(node => nodeMap.set(node.id, node));

  const preferenceFields = new Set();
  flowData.nodes.forEach(node => {
    node?.data?.inputs?.forEach(input => {
      if (input.field === 'preference') {
        preferenceFields.add(node.id);
      }
    });
  });

  const generatePromptList = (fields) =>
    fields.map(f => f.toLowerCase().replace(/_/g, " ")).join(", ");

  const generateOptionList = (options = [], type) =>
    options
      .filter(opt => opt?.id && String(opt.id).trim() !== "")
      .map(opt => ({
        id: `P-${String(opt.id).trim()}`,
        value: opt?.value ?? "",
        type: type ?? "text",
      }));

  const getSlotList = (userSlot, isuserOption) => {
    if (!isuserOption || typeof userSlot !== "string") {
      return;
    }

    const parts = userSlot?.split("-");
    if (parts.length < 6) {
      throw new Error("❌ Invalid userOption format, expected at least 6 parts separated by '-'");
    }

    const id = parts[2] || "NA";
    const startTime = parts[3];
    const endTime = parts[4];
    const interval = parseInt(parts[5], 10);
    const buffer = parseInt(parts[6] || "0", 10);

    if (!startTime || !endTime || Number.isNaN(interval)) {
      throw new Error("❌ startTime, endTime, and interval are required in userOption");
    }

    const slots = [];
    const timeToDate = (timeStr) => {
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    };

    const formatLocal = (date) => {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: userTimeZone,
      });
    };

    let current = timeToDate(startTime);
    const end = timeToDate(endTime);

    slots.push({
      id: `P-SSL-${Date.now()}`,
      value: "Choose your available slot here",
      type: "List"
    });

    while (current.getTime() + interval * 60000 <= end.getTime()) {
      const slotStart = formatLocal(current);
      const slotEnd = formatLocal(new Date(current.getTime() + interval * 60000));

      slots.push({
        id: `P-SSL-${id}-[${slotStart}-${slotEnd}]`,
        value: `${slotStart} - ${slotEnd}`,
        type: "List",
      });

      current = new Date(current.getTime() + (interval + buffer) * 60000);
    }
    return slots;
  };

  const getOptionSlots = (slots = []) => {
    const options = slots.flatMap((dateItem) => {
      if (!Array.isArray(dateItem?.slots) || !dateItem.slots.length) return [];

      const formattedDate = new Date(dateItem?.date).toLocaleDateString([], {
        month: "short",
        day: "2-digit",
      });

      return dateItem.slots
        .filter(({ id, start, end, interval }) => id && start && end && interval)
        .map(({ id, start, end, interval, buffer }) => {
          const startTime = new Date(start).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: userTimeZone,
          }).replace(/^0/, "");

          const endTime = new Date(end).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: userTimeZone,
          });

          return {
            id: `P-SL-${id}-${startTime}-${endTime}-${interval}-${buffer || 0}`,
            value: `${startTime} - ${endTime}, ${formattedDate}`,
            type: "List",
          };
        });
    });

    return [
      {
        id: `P-SL-${Date.now()}`,
        value: "Choose your common available Slot here",
        type: "List",
      },
      ...options,
    ];
  };

  const parseFollowUp = (input, currentStep, nodeId) => {
    const { field, value = "", type, options, slots } = input || {};
    const optionList = generateOptionList(options, type);
    const optionSlots = getOptionSlots(slots);
    let requiredFields = [];

    try {
      if (field === "replay") {
        requiredFields = [...(value?.match(/\[(.*?)\]/g) || [])].map(v => v.slice(1, -1));
      }

      const cleanedMessage = field === "messages" ? value?.replace(/<[^>]+>/g, "").trim() : "";
      const validationHint = getValidationHint(type, requiredFields);

      switch (field) {
        case "messages":
          return `- Initial Message:\n  - "${cleanedMessage}"\n  - Ask this exactly without rephrasing. Politely verify spelling. If off-topic, redirect to this question again.`;

        case "replay":
          return requiredFields?.length
            ? `- Follow-up Required (Step ${currentStep}):\n  - Ask for: ${generatePromptList(requiredFields)}\n - ${validationHint}\n  - Wait until all required fields are collected before proceeding.`
            : `- Follow-up (Step ${currentStep}): No required fields detected. You may proceed.`;

        case "preference": {
          const baseText = ` - Initial Preference (Step ${currentStep}):\n  -If Initial Preference: Return ONLY this JSON array. No quotes, markdown, or formatting.\n 
            - **STRICT FINAL RESPONSE REQUIREMENTS**\n
            - **MANDATORY DATA OBJECT CREATION**:\n,`;

          const jsonData =
            type?.toLowerCase() !== "slot"
              ? `${JSON.stringify(optionList)}.\n - [preferenceTitle] = ${optionList[0]?.value || 'Choose your available option here'}`
              : `${JSON.stringify(optionSlots)}.\n - [preferenceTitle] = ${optionSlots[0]?.value || 'Choose your common available Slot here'}`;

          return `${baseText}\n${jsonData}`;
        }

        default:
          return null;
      }
    } catch (err) {
      console.error("Error in follow-up parsing:", err.message);
      return null;
    }
  };

  const getNodeConnections = (nodeId) => {
    const direct = [];
    const conditionalOption = [];
    const conditionalSlots = [];

    for (const edge of flowData.edges || []) {
      if (edge.source === nodeId) {
        const { sourceHandle = "", target } = edge;

        if (sourceHandle.startsWith("option-")) {
          conditionalOption.push({
            optionId: `P-${sourceHandle.split("-")[1]}`,
            target,
          });
        } else if (sourceHandle.startsWith("slot-") || sourceHandle.includes("slot")) {
          conditionalSlots.push({
            target,
            slotId: sourceHandle,
            sourceHandle
          });
        } else {
          direct.push(target);
        }
      }
    }

    return {
      directTargets: direct,
      conditionalTargets: conditionalOption,
      conditionalSlots: conditionalSlots
    };
  };

  const sanitizeFieldName = (str) => {
    if (!str) return;
    let clean = String(str);
    clean = clean.replace(/<[^>]*>/g, '');
    clean = clean.replace(/\b(?:javascript|data|vbscript):/gi, '');
    clean = clean.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');
    return clean.trim();
  };

  const processNode = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stepCounter++;

    const node = nodeMap.get(nodeId);
    if (!node?.data?.inputs) return;

    const stepInstructions = [];
    const { directTargets, conditionalTargets, conditionalSlots } = getNodeConnections(nodeId);

    const isTerminalStep =
      !directTargets?.length &&
      !conditionalTargets?.length &&
      !conditionalSlots?.length;

    for (const input of node.data.inputs) {
      const instruction = parseFollowUp(input, stepCounter, nodeId);
      if (instruction) stepInstructions.push(instruction);
    }

    const step = {
      section: `Step ${stepCounter}`,
      nodeId,
      instructions: [`- sourceNodeId: '${nodeId}'`, ...stepInstructions],
    };

    if (directTargets?.length && !conditionalTargets?.length && !conditionalSlots?.length) {
      step.instructions.push(
        `- Navigate to the next Target sourceNodeId = '${directTargets[0]}'\n  - Condition: Proceed only after required data is Collected and correct Format.`
      );
    } else if (conditionalTargets?.length) {
      step.instructions.push(
        `- Map Consultant selection to target sourceNodeId using id. Proceed only if id(example:P-1751966538888) matches one of the below:\n 
        - ${conditionalTargets
          .map(
            (ct) =>
              `- if Consultant response = ${ct.optionId}, navigate to the step with sourceNodeId = ${ct.target}`
          )
          .join("\n  - ")}`
      );
    } else if (conditionalSlots?.length) {
      const slotList = getSlotList(ConsultantMessage, userOption) || [];
      const slotListJSON = JSON.stringify(slotList);
      step.instructions.push(
        `- Slot Selection Navigation:\n` +
        `- If New Consultant Message containing response starts with "P-SL", Return ONLY this JSON array ${slotListJSON}. [preferenceTitle] = ${slotList[0]?.value || "Choose your available slot here"} , No quotes, markdown, or formatting.\n` +
        `- If New Consultant Message containing response starts with "P-SSL-", navigate to next node with sourceNodeId = '${conditionalSlots[0]?.target}'\n` +
        `- Condition: Collect final time slot selection before proceeding\n`
      );
    }

    if (isTerminalStep) {
      const fieldNames = [];
      let hasPreference = false;

      flowData?.nodes?.forEach((node) => {
        node?.data?.inputs?.forEach((input) => {
          if (input?.field === "replay") {
            const matches = input?.value?.match(/\[([^\]]+)\]/g);
            if (matches) {
              matches.forEach((match) => {
                let fieldName = match?.replace(/[\[\]]/g, "");
                fieldName = sanitizeFieldName(fieldName);

                if (fieldName && !fieldNames?.includes(fieldName)) {
                  fieldNames.push(fieldName);
                }
              });
            }
          }
          if (input?.field === "preference") {
            hasPreference = true;
          }
        });
      });

      const dataObjectStructure = `{
        ${fieldNames
          ?.map((f) => `"${f}": "[collected_value || null]"`)
          .join(",\n")}${
          hasPreference
            ? ',\n  "preference": [{ [preferenceTitle]: [optionValues] }, { [preferenceTitle]: [selectedSlots],...}]'
            : ""
        }
      }`;

      const preferenceInstructions = hasPreference
        ? [
          `- For preferences: Create array of selected all option objects { [preferenceTitle]: [optionValues],... }`,
          `- For slots: Push consultant selected time slots as { [preferenceTitle]: [selectedSlots],... }`
        ]
        : [];

      step.instructions.push(
        `- **STRICT FINAL RESPONSE REQUIREMENTS**`,
        `- **MANDATORY DATA OBJECT CREATION**:`,
        `- If not an Initial Preference: Return ONLY this ${dataObjectStructure} JSON array without fail. No quotes, markdown, or formatting.\n`,
        ...preferenceInstructions,
        `- **TERMINAL STEP**: This is the final step. Conclude conversation after data collection.`
      );
    }

    output.push(step);

    const nextNodes = [
      ...directTargets,
      ...conditionalTargets.map((c) => c.target),
      ...conditionalSlots.map((s) => s.target).filter(Boolean)
    ];

    const uniqueNextNodes = [...new Set(nextNodes)];
    uniqueNextNodes.forEach((next) => {
      if (nodeMap.has(next)) processNode(next, visited);
    });
  };

  const startNode = flowData.nodes[0];
  if (startNode) {
    processNode(startNode.id);
  }

  output.push({
    section: 'Global AI Rules',
    instructions: GLOBAL_INSTRUCTIONS
  });

  output.push(
    {
      section: "Domain-Specific Actions",
      instructions: [
        '- Detect user intent: booking, rescheduling, cancelling, general query.',
        '- Look for keywords like "Book slot", "Cancel appointment", etc. and route accordingly.',
      ],
    },
  );
  return output;
};

module.exports = generateDynamicFlowData;


















 // instructions: [
      //   '- Rule: Do NOT mention or explain your actions (e.g., going back, repeating, restarting, step flow, etc..). Just ask the next message directly.',
      //   '- Rule: When navigating to a previous step, display the original message exactly as given — no justification, no context, no paraphrasing.',
      //   '- Rule: If reaching a preference step again, display ONLY the same JSON array from the original step without extra comments or wrapping text.',
      //   '- Rule: NEVER add phrases like "You selected", "Let me ask again", "Going back", "Repeating", "Based on your answer", etc.',
      //   '- Rule: Ask each question in the exact wording provided in the original instruction ("Initial Message") block.',
      //   '- Rule: If any step is marked as "Mandatory: true", it must be collected based on the root map of steps before proceeding.',
      //   '- Rule: If any field has validation requirements, strictly enforce them with only Error Message[Eg:Please enter a valid [fieldName]] before proceeding.',
      //   '- Rule: If multiple required fields are mentioned, collect all before moving forward.',
      //   '- Rule: Allow RE-COLLECT the fields **if** the user explicitly wants to update or is redirected to that step.',
      //   '- Rule: Treat every step transition as atomic. Do not carry over assistant reasoning or interpretation.',
      //   '- Tone  Rule: Ask all questions politely, directly, and neutrally — avoid robotic or overly smart tone.',
      //   '- Rule: Never alter, summarize, interpret, or wrap the message. Use the exact content inside instructions without change.',
      //   '- Rule: Respond with no more than **20 words**.',
      //   '- Rule: If the conversation flow has no next target step, politely conclude the conversation.✅ Final step must include both data object and thank-you message.',
      //   '- Keyword Enforcement: "Initial Message", "Follow-up Required", "Initial Preference", "Mandatory", "Expected", "Validate" — respect these strictly as behavioral directives.',
        
      //   '**Fallback Handling:**',
      //   '- Fallback: If the user provides invalid input more than 2 times for a required field, politely re-state the expected format with an example.',
      //   '- Fallback: Respond politely based on available flodata for off-topic queries and back to the correct step, Ensuring the conversation stays aligned with the flow structure.',
      //   '- Fallback: After 3 failed attempts, offer clarification or escalate gently with a suggestion like: "Would you like an example?" or "You can say ‘help’ for guidance.',
      //   '- Fallback: Never get stuck or loop indefinitely. If confusion persists, offer to restart the current step with: "Let\'s try this step again from the beginning.',
      //   '- Fallback  Trigger: Applies only to inputs marked as "Mandatory" with an "Expected" format.',
      //   '- Fallback  Behavior: Always maintain polite tone, avoid blame, and rephrase only the error explanation — not the original question.',
      // ]





  

