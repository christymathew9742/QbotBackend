// const { getValidationHint, isUserOption } = require('../../utils/common');
// const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// const GLOBAL_INSTRUCTIONS = [
//   '- Respond max 20 words.',
//   '- Out-of-topic: reply politely and meaningfully, reflect tone/emotion, if needed repeat the question dynamically in a natural way, then continue correct/next step.',
//   '- Offensive/sexual input: reply politely and meaningfully, reflect tone/emotion, if needed repeat the question dynamically in a natural way, then continue correct/next step.',
//   '- Emojis: detect emotion (happy, sad, angry, laughing, etc), respond empathetically, then continue correct/next step.',
//   '- Always refer to conversation history for context and continuity.',
//   '- Fallback: if invalid input >2 times, restate expected format with example.',
//   '- After 3 failures, offer clarification or suggest "help" or example.',
//   '- Never loop indefinitely; restart step politely if confusion persists.',
//   '- Keyword Enforcement: "Initial Message", "Follow-up Required", "Initial Preference", "Mandatory", "Expected", "Validate" — respect these strictly as behavioral directives.',
//   '- After collecting all required fields, firmly conclude the conversation without extending further.'
// ];

// const GLOBAL_RULES = [
//   '- Rule: Do NOT mention or explain your actions (e.g., going back, repeating, restarting, step flow, etc..). Just ask the next message directly.',
//   '- Rule: When navigating to a previous step, display the original message exactly as given — no justification, no context, no paraphrasing.',
//   '- Rule: If reaching a preference step again, display ONLY the same JSON array from the original step without extra comments or wrapping text.',
//   '- Rule: NEVER add phrases like "You selected", "Let me ask again", "Going back", "Repeating", "Based on your answer", etc.',
//   '- Rule: Ask each question in the exact wording provided in the original instruction ("Initial Message") block.',
//   '- Rule: If any step is marked as "Mandatory: true", it must be collected based on the root map of steps before proceeding.',
//   '- Rule: If any field has validation requirements, strictly enforce them with only Error Message[Eg:Please enter a valid [fieldName]] before proceeding.',
//   '- Rule: If multiple required fields are mentioned, collect all before moving forward.',
//   '- Rule: Allow RE-COLLECT the fields **if** the user explicitly wants to update or is redirected to that step.',
//   '- Rule: Step jump: if user mentions related step, jump and collect all required fields.',
// ];

// const formatTime = (date, hour12 = true) =>
//   date.toLocaleTimeString('en-US', {
//     hour: 'numeric',
//     minute: '2-digit',
//     hour12,
//     timeZone: userTimeZone,
//   }).replace(/^0/, '');

// const sanitizeFieldName = str =>
//   str
//     ? String(str)
//         .replace(/<[^>]*>/g, '')
//         .replace(/\b(?:javascript|data|vbscript):/gi, '')
//         .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
//         .trim()
//     : '';

// const timeToDate = (t) => {
//   const [h, m] = t.split(':').map(Number);
//   const d = new Date();
//   d.setHours(h, m, 0, 0);
//   return d;
// };

// const generateDynamicFlowData = async (flowData, ConsultantMessage) => {
//   if (!flowData?.nodes?.length) return [];

//   const output = [];
//   const nodeMap = new Map(flowData.nodes.map(node => [node.id, node]));
//   const visited = new Set();
//   let stepCounter = 0;

//   const userOption = isUserOption(ConsultantMessage, 'P-SL');

//   const fieldNames = new Set();
//   let hasPreference = false;
//   for (const node of flowData.nodes) {
//     for (const input of node?.data?.inputs || []) {
//       if (input?.field === 'replay') {
//         const matches = input.value?.match(/\[([^\]]+)\]/g) || [];
//         matches.forEach(match => {
//           const f = sanitizeFieldName(match.replace(/[\[\]]/g, ''));
//           if (f) fieldNames.add(f);
//         });
//       } else if (input.field === 'preference') {
//         hasPreference = true;
//       }
//     }
//   }

//   const generateOptionList = (options = [], type) =>
//     options.filter(opt => opt?.id).map(opt => ({
//       id: `P-${String(opt.id).trim()}`,
//       value: opt?.value ?? '',
//       type: type ?? 'text',
//     }));

//   const getOptionSlots = (slots = []) => {
//     const result = [];
//     for (const dateItem of slots) {
//       if (!Array.isArray(dateItem?.slots)) continue;
//       const formattedDate = new Date(dateItem.date).toLocaleDateString([], { month: 'short', day: '2-digit' });
//       for (const s of dateItem.slots) {
//         result.push({
//           id: `P-SL-${s.id}-${formatTime(new Date(s.start), false)}-${formatTime(new Date(s.end), false)}-${s.interval}-${s.buffer || 0}`,
//           value: `${formatTime(new Date(s.start), false)} - ${formatTime(new Date(s.end), false)}, ${formattedDate}`,
//           type: 'List',
//         });
//       }
//     }
//     return [
//       { id: `P-SL-${Date.now()}`, value: 'Choose your common available Slot here', type: 'List' },
//       ...result,
//     ];
//   };

//   const getSlotList = (userSlot, isUserOpt) => {
//     if (!isUserOpt || typeof userSlot !== 'string') return [];
//     const parts = userSlot.split('-');
//     if (parts.length < 6) return [];

//     const [, , id = 'NA', startTime, endTime, intervalStr, bufferStr = '0'] = parts;
//     const interval = parseInt(intervalStr, 10);
//     const buffer = parseInt(bufferStr, 10);
//     if (!startTime || !endTime || Number.isNaN(interval)) return [];

//     const slots = [{ id: `P-SSL-${Date.now()}`, value: 'Choose your available slot here', type: 'List' }];
//     let current = timeToDate(startTime),
//       end = timeToDate(endTime);
//     while (current.getTime() + interval * 60000 <= end.getTime()) {
//       const slotStart = formatTime(current);
//       const slotEnd = formatTime(new Date(current.getTime() + interval * 60000));
//       slots.push({
//         id: `P-SSL-${id}-[${slotStart}-${slotEnd}]`,
//         value: `${slotStart} - ${slotEnd}`,
//         type: 'List',
//       });
//       current = new Date(current.getTime() + (interval + buffer) * 60000);
//     }
//     return slots;
//   };

//   const edgeCache = new Map();
//   for (const edge of flowData.edges || []) {
//     if (!edgeCache.has(edge.source)) edgeCache.set(edge.source, []);
//     edgeCache.get(edge.source).push(edge);
//   }

//   const getNodeConnections = nodeId => {
//     const direct = [], conditionalOption = [], conditionalSlots = [];
//     for (const edge of edgeCache.get(nodeId) || []) {
//       const { sourceHandle = '', target } = edge;
//       if (sourceHandle.startsWith('option-'))
//         conditionalOption.push({ optionId: `P-${sourceHandle.split('-')[1]}`, target });
//       else if (sourceHandle.startsWith('slot-') || sourceHandle.includes('slot'))
//         conditionalSlots.push({ target, slotId: sourceHandle });
//       else direct.push(target);
//     }
//     return { directTargets: direct, conditionalTargets: conditionalOption, conditionalSlots };
//   };

//   const processNode = nodeId => {
//     if (visited.has(nodeId)) return;
//     visited.add(nodeId);

//     const node = nodeMap.get(nodeId);
//     if (!node?.data?.inputs) return;

//     stepCounter++;
//     const stepInstructions = [];
//     const { directTargets, conditionalTargets, conditionalSlots } = getNodeConnections(nodeId);
//     const isTerminal = !directTargets.length && !conditionalTargets.length && !conditionalSlots.length;
//     const context = { messageBuffer: [], lastField: null };

//     for (let i = 0; i < node.data.inputs.length; i++) {
//       const input = node.data.inputs[i];
//       const nextField = node.data.inputs[i + 1];
//       const isLast = i === node.data.inputs.length - 1;

//       try {
//         const { field, value = '', type, options, slots } = input || {};
//         const validationHint = getValidationHint(type, []);
//         const cleanedMessage = field === 'messages' ? value.replace(/<[^>]+>/g, '').trim() : '';

//         if (context.lastField !== field && field !== 'messages') context.messageBuffer = [];
//         context.lastField = field;
//         if (cleanedMessage) context.messageBuffer.push(cleanedMessage);

//         if (field === 'messages') {
//           const shouldFlush = nextField?.field !== 'messages' || isLast;
//           if (shouldFlush && context.messageBuffer.length && type === 'Text') {
//             stepInstructions.push(
//               `- Initial Message:\n - [${context.messageBuffer.join(', ')}]\n  - Ask this exactly without rephrasing.`
//             );
//             context.messageBuffer = [];
//           }
//         } else if (field === 'replay') {
//           const reqFields = (value.match(/\[(.*?)\]/g) || []).map(v => v.slice(1, -1));
//           if (reqFields.length) {
//             stepInstructions.push(
//               `- Follow-up Required (Step ${stepCounter}):\n  - Ask for: ${reqFields.join(', ')}\n - ${validationHint}\n  - Wait until all required fields are collected before proceeding.`
//             );
//           }
//         } else if (field === 'preference') {
//           const optionsJSON =
//             type?.toLowerCase() !== 'slot'
//               ? generateOptionList(options, type)
//               : getOptionSlots(slots);
//           stepInstructions.push(
//             ` - Initial Preference (Step ${stepCounter}):\n  -If Initial Preference: Return ONLY this JSON array. No quotes, markdown, or formatting.\n - **STRICT FINAL RESPONSE REQUIREMENTS**\n - **MANDATORY DATA OBJECT CREATION**:\n${JSON.stringify(optionsJSON)}.\n - [preferenceTitle] = ${optionsJSON[0]?.value || 'Choose your available option here'}`
//           );
//         }
//       } catch (err) {
//         console.error('Error processing input:', err.message);
//       }
//     }

//     if (directTargets.length && !conditionalTargets.length && !conditionalSlots.length) {
//       stepInstructions.push(
//         `- Navigate to the next Target sourceNodeId = '${directTargets[0]}'\n  - Condition: Proceed only after required data is Collected and correct Format.`
//       );
//     } else if (conditionalTargets.length) {
//       stepInstructions.push(
//         `- Map Consultant selection to target sourceNodeId using id. Proceed only if id(example:P-1751966538888) matches one of the below:\n - ${conditionalTargets
//           .map(ct => `- if Consultant response = ${ct.optionId}, navigate to the step with sourceNodeId = ${ct.target}`)
//           .join('\n  - ')}`
//       );
//     } else if (conditionalSlots.length) {
//       const slotList = getSlotList(ConsultantMessage, userOption) || [];
//       stepInstructions.push(
//         `- Slot Selection Navigation:\n- If New Consultant Message starts with "P-SL", Return ONLY this JSON array ${JSON.stringify(
//           slotList
//         )}. [preferenceTitle] = ${slotList[0]?.value || 'Choose your available slot here'}, No quotes, markdown, or formatting.\n- If New Consultant Message starts with "P-SSL-", navigate to next node with sourceNodeId = '${conditionalSlots[0]?.target}'\n- Condition: Collect final time slot selection before proceeding\n`
//       );
//     }

//     if (isTerminal) {
//       const finalObj = {
//         ...(Object.fromEntries([...fieldNames].map(f => [f, '[collected_value || null]']))),
//       };
//       if (hasPreference) {
//         finalObj.preference = [
//           { '[preferenceTitle]': '[optionValues]' },
//           { '[preferenceTitle]': '[selectedSlots]' },
//         ];
//       }

//       stepInstructions.push(
//         `- **STRICT FINAL RESPONSE REQUIREMENTS**`,
//         `- **MANDATORY DATA OBJECT CREATION**:`,
//         `- If not an Initial Preference: Return ONLY this ${JSON.stringify(finalObj, null, 2)} JSON array without fail. No quotes, markdown, or formatting.\n`,
//         `- For preferences: Create array of selected all option objects { [preferenceTitle]: [optionValues],... }`,
//         `- For slots: Push consultant selected time slots as { [preferenceTitle]: [selectedSlots],... }`,
//         `- **TERMINAL STEP**: This is the final step. Conclude conversation after all required field data collection.`
//       );
//     }

//     output.push({
//       section: `Step ${stepCounter}`,
//       nodeId,
//       instructions: [`- sourceNodeId: '${nodeId}'`, ...stepInstructions],
//     });

//     const nextNodes = new Set([
//       ...directTargets,
//       ...conditionalTargets.map(c => c.target),
//       ...conditionalSlots.map(s => s.target).filter(Boolean),
//     ]);
//     for (const next of nextNodes) {
//       if (nodeMap.has(next)) processNode(next);
//     }
//   };

//   try {
//     const firstNode = flowData.nodes[0];
//     if (firstNode) processNode(firstNode.id);
//   } catch (err) {
//     console.error('Flow generation error:', err.message);
//   }

//   output.push({ section: 'Global AI Rules', instructions: GLOBAL_RULES });
//   output.push({ section: 'Global AI Instructions', instructions: GLOBAL_INSTRUCTIONS });

//   return output;
// };

// module.exports = generateDynamicFlowData;




const { getValidationHint, isUserOption } = require('../../utils/common');
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const GLOBAL_INSTRUCTIONS = [
  '- Respond max 20 words.',
  '- Out-of-topic: reply politely and meaningfully, reflect tone/emotion, if needed repeat the question dynamically in a natural way, then continue correct/next step.',
  '- Offensive/sexual input: reply politely and meaningfully, reflect tone/emotion, if needed repeat the question dynamically in a natural way, then continue correct/next step.',
  '- Emojis: detect emotion (happy, sad, angry, laughing, etc), respond empathetically, then continue correct/next step.',
  '- Always refer to conversation history for context and continuity.',
  '- Fallback: if invalid input >2 times, restate expected format with example.',
  '- After 3 failures, offer clarification or suggest "help" or example.',
  '- Never loop indefinitely; restart step politely if confusion persists.',
  '- Keyword Enforcement: "Initial Message", "Follow-up Required", "Initial Preference", "Mandatory", "Expected", "Validate" — respect these strictly as behavioral directives.',
  '- After collecting all required fields, firmly conclude the conversation without extending further.'
];

const GLOBAL_RULES = [
  '- Rule: Do NOT mention or explain your actions (e.g., going back, repeating, restarting, step flow, etc..). Just ask the next message directly.',
  '- Rule: When navigating to a previous step, display the original message exactly as given — no justification, no context, no paraphrasing.',
  '- Rule: If reaching a preference step again, display ONLY the same JSON array from the original step without extra comments or wrapping text.',
  '- Rule: NEVER add phrases like "You selected", "Let me ask again", "Going back", "Repeating", "Based on your answer", etc.',
  '- Rule: Ask each question in the exact wording provided in the original instruction ("Initial Message") block.',
  '- Rule: If any step is marked as "Mandatory: true", it must be collected based on the root map of steps before proceeding.',
  '- Rule: If any field has validation requirements, strictly enforce them with only Error Message[Eg:Please enter a valid [fieldName]] before proceeding.',
  '- Rule: If multiple required fields are mentioned, collect all before moving forward.',
  '- Rule: Allow RE-COLLECT the fields **if** the user explicitly wants to update or is redirected to that step.',
  '- Rule: Step jump: if user mentions related step, jump and collect all required fields.',
  "- Rule: Always ask and output ```...``` content exactly as written; never skip, rephrase, parse, format, or sanitize it under any condition."
];

const STRICT_OBJECT = 'Return ONLY this JSON array. No quotes, markdown, or formatting.\n - **STRICT FINAL RESPONSE REQUIREMENTS**\n - **MANDATORY DATA OBJECT CREATION**:\n';

const formatTime = (date, hour12 = true) =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    timeZone: userTimeZone,
  }).replace(/^0/, '');

const sanitizeFieldName = str =>
  str
    ? String(str)
        .replace(/<[^>]*>/g, '')
        .replace(/\b(?:javascript|data|vbscript):/gi, '')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
        .trim()
    : '';

const timeToDate = (t) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

const optionObjectCache = new Map(); 
const optionJsonCache = new Map();

const safeStringify = (obj) => {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    try {
      return JSON.stringify(Array.isArray(obj) ? obj.slice(0, 10) : {});
    } catch (e) {
      return '[]';
    }
  }
};

const generateDynamicFlowData = async (flowData, ConsultantMessage) => {
  if (!flowData?.nodes?.length) return [];

  const output = [];
  const nodeMap = new Map(flowData.nodes.map(node => [node.id, node]));
  const visited = new Set();
  let stepCounter = 0;
  const userOption = isUserOption(ConsultantMessage, 'P-SL');
  const fieldNames = new Set();
  let hasPreference = false;
  for (const node of flowData.nodes) {
    for (const input of node?.data?.inputs || []) {
      if (input?.field === 'replay') {
        const matches = input.value?.match(/\[([^\]]+)\]/g) || [];
        matches.forEach(match => {
          const f = sanitizeFieldName(match.replace(/[\[\]]/g, ''));
          if (f) fieldNames.add(f);
        });
      } else if (input.field === 'preference') {
        hasPreference = true;
      }
    }
  }

  const generateOptionList = (options = [], type, nodeKey = '') => {
    if (nodeKey && optionObjectCache.has(nodeKey)) return optionObjectCache.get(nodeKey);
    const res = (options || []).filter(opt => opt?.id).map(opt => ({
      id: `P-${String(opt.id).trim()}`,
      value: opt?.value ?? '',
      type: type ?? 'text',
    }));
    if (nodeKey) optionObjectCache.set(nodeKey, res);
    return res;
  };

  const getOptionSlots = (slots = [], nodeKey = '') => {
    if (nodeKey && optionObjectCache.has(nodeKey)) return optionObjectCache.get(nodeKey);
    const result = [];
    for (const dateItem of slots || []) {
      if (!Array.isArray(dateItem?.slots)) continue;
      const formattedDate = new Date(dateItem.date).toLocaleDateString([], { month: 'short', day: '2-digit' });
      for (const s of dateItem.slots) {
        result.push({
          id: `P-SL-${s.id}-${formatTime(new Date(s.start), false)}-${formatTime(new Date(s.end), false)}-${s.interval}-${s.buffer || 0}`,
          value: `${formatTime(new Date(s.start), false)} - ${formatTime(new Date(s.end), false)}, ${formattedDate}`,
          type: 'List',
        });
      }
    }
    const out = [
      { id: `P-SL-${Date.now()}`, value: 'Choose your common available Slot here', type: 'List' },
      ...result,
    ];
    if (nodeKey) optionObjectCache.set(nodeKey, out);
    return out;
  };

  const getSlotList = (userSlot, isUserOpt) => {
    if (!isUserOpt || typeof userSlot !== 'string') return [];
    const parts = userSlot.split('-');
    if (parts.length < 6) return [];

    const [, , id = 'NA', startTime, endTime, intervalStr, bufferStr = '0'] = parts;
    const interval = parseInt(intervalStr, 10);
    const buffer = parseInt(bufferStr, 10);
    if (!startTime || !endTime || Number.isNaN(interval)) return [];

    const slots = [{ id: `P-SSL-${Date.now()}`, value: 'Choose your available slot here', type: 'List' }];
    let current = timeToDate(startTime),
      end = timeToDate(endTime);
    while (current.getTime() + interval * 60000 <= end.getTime()) {
      const slotStart = formatTime(current);
      const slotEnd = formatTime(new Date(current.getTime() + interval * 60000));
      slots.push({
        id: `P-SSL-${id}-[${slotStart}-${slotEnd}]`,
        value: `${slotStart} - ${slotEnd}`,
        type: 'List',
      });
      current = new Date(current.getTime() + (interval + buffer) * 60000);
    }
    return slots;
  };

  const edgeCache = new Map();
  for (const edge of flowData.edges || []) {
    if (!edgeCache.has(edge.source)) edgeCache.set(edge.source, []);
    edgeCache.get(edge.source).push(edge);
  }

  const getNodeConnections = nodeId => {
    const direct = [], conditionalOption = [], conditionalSlots = [];
    for (const edge of edgeCache.get(nodeId) || []) {
      const { sourceHandle = '', target } = edge;
      if (sourceHandle.startsWith('option-'))
        conditionalOption.push({ optionId: `P-${sourceHandle.split('-')[1]}`, target });
      else if (sourceHandle.startsWith('slot-') || sourceHandle.includes('slot'))
        conditionalSlots.push({ target, slotId: sourceHandle });
      else direct.push(target);
    }
    return { directTargets: direct, conditionalTargets: conditionalOption, conditionalSlots };
  };

  const processNode = nodeId => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node?.data?.inputs) return;

    stepCounter++;
    const stepInstructions = [];
    const { directTargets, conditionalTargets, conditionalSlots } = getNodeConnections(nodeId);
    const isTerminal = !directTargets.length && !conditionalTargets.length && !conditionalSlots.length;
    const context = { messageBuffer: [], lastField: null };

    for (let i = 0; i < node.data.inputs.length; i++) {
      const input = node.data.inputs[i];
      const nextField = node.data.inputs[i + 1];
      const isLast = i === node.data.inputs.length - 1;

      try {
        const { field, value = '', type, options, slots, fileData } = input || {};
        const validationHint = getValidationHint(type, []);
        context.messageBuffer = context.messageBuffer || [];

        if (context.lastField !== field && field !== 'messages') context.messageBuffer = [];
        context.lastField = field;

        if (field === 'messages') {
          const cleaned = value?.replace(/<[^>]+>/g, '').trim();

          if (cleaned) context.messageBuffer.push(cleaned);

          if (Array.isArray(fileData) && fileData.length) {
            const fileId = fileData
              .filter(f => f.fileId)
              .map(f => f.fileId)
              .join(', ');
            if (fileId) context.messageBuffer.push(fileId);
          }

          const shouldFlush = nextField?.field !== 'messages' || isLast;
          if (shouldFlush && context.messageBuffer.length) {
            const message = context.messageBuffer.join(', ');
            stepInstructions.push(
              `- Initial Message:\n - \`\`\`${message},\`\`\` - Ask this exactly without rephrasing.`
            );
            context.messageBuffer = [];
          }

        } else if (field === 'replay') {
          const reqFields = (value.match(/\[(.*?)\]/g) || []).map(v => v.slice(1, -1));
          if (reqFields.length) {
            stepInstructions.push(
              `- Follow-up Required (Step ${stepCounter}):\n  - Ask for: ${reqFields.join(', ')}\n - ${validationHint}\n  - Wait until all required fields are collected before proceeding.`
            );
          }
        } else if (field === 'preference') {
          const nodeKey = `${nodeId}_preference_${i}`;

          const optionsJSONObj =
            type?.toLowerCase() !== 'slot'
              ? generateOptionList(options, type, nodeKey)
              : getOptionSlots(slots, nodeKey);

          if (nodeKey && !optionJsonCache.has(nodeKey)) {
            optionJsonCache.set(nodeKey, safeStringify(optionsJSONObj));
          }
          const optionsJsonString = optionJsonCache.get(nodeKey) || safeStringify(optionsJSONObj);

          stepInstructions.push(
            ` - Initial Preference (Step ${stepCounter}):\n  -If Initial Preference: ${STRICT_OBJECT} ${optionsJsonString}.\n - [preferenceTitle] = ${optionsJSONObj[0]?.value || 'Choose your available option here'}`
          );
        }
      } catch (err) {
        console.error('Error processing input:', err && err.message ? err.message : err);
      }
    }

    if (directTargets.length && !conditionalTargets.length && !conditionalSlots.length) {
      stepInstructions.push(
        `- Mandatory Fields: none\n - Auto Proceed: true.\n   - If current step has no mandatory fields to collect:\n → Send Initial Message immediately.\n → Auto-navigate to next target sourceNodeId = '${directTargets[0]}' without waiting for user input.`
      );
    } else if (conditionalTargets.length) {
      stepInstructions.push(
        `- Map Consultant selection to target sourceNodeId using id. Proceed only if id(example:P-1751966538888) matches one of the below:\n - ${conditionalTargets
          .map(ct => `- if Consultant response = ${ct.optionId}, navigate to the step with sourceNodeId = ${ct.target}`)
          .join('\n  - ')}`
      );
    } else if (conditionalSlots.length) {
      const nodeKey = `${nodeId}_slots`;
      const slotList = getSlotList(ConsultantMessage, userOption) || [];
      if (slotList.length && !optionObjectCache.has(nodeKey)) optionObjectCache.set(nodeKey, slotList);

      if (optionObjectCache.has(nodeKey) && !optionJsonCache.has(nodeKey)) {
        optionJsonCache.set(nodeKey, safeStringify(optionObjectCache.get(nodeKey)));
      }
      const slotJsonString = optionJsonCache.get(nodeKey) || '[]';

      stepInstructions.push(
        `- Slot Selection Navigation:\n- If New Consultant Message starts with "P-SL", Return ONLY this JSON array ${slotJsonString}. [preferenceTitle] = ${slotList[0]?.value || 'Choose your available slot here'}, No quotes, markdown, or formatting.\n- If New Consultant Message starts with "P-SSL-", navigate to next node with sourceNodeId = '${conditionalSlots[0]?.target}'\n- Condition: Collect final time slot selection before proceeding\n`
      );
    }

    if (isTerminal) {
      const finalObj = {
        ...(Object.fromEntries([...fieldNames].map(f => [f, '[collected_value || null]']))),
      };
      if (hasPreference) {
        finalObj.preference = [
          { '[preferenceTitle]': '[optionValues]' },
          { '[preferenceTitle]': '[selectedSlots]' },
        ];
      }

      stepInstructions.push(
        `- **STRICT FINAL RESPONSE REQUIREMENTS**`,
        `- **MANDATORY DATA OBJECT CREATION**:`,
        `- If not an Initial Preference: Return ONLY this ${safeStringify(finalObj, null, 2)} JSON array without fail. No quotes, markdown, or formatting.\n`,
        `- For preferences: Create array of selected all option objects { [preferenceTitle]: [optionValues],... }`,
        `- For slots: Push consultant selected time slots as { [preferenceTitle]: [selectedSlots],... }`,
        `- **TERMINAL STEP**: This is the final step. Conclude conversation after all required field data collection.`
      );
    }

    output.push({
      section: `Step ${stepCounter}`,
      nodeId,
      instructions: [`- sourceNodeId: '${nodeId}'`, ...stepInstructions],
    });

    const nextNodes = new Set([
      ...directTargets,
      ...conditionalTargets.map(c => c.target),
      ...conditionalSlots.map(s => s.target).filter(Boolean),
    ]);
    for (const next of nextNodes) {
      if (nodeMap.has(next)) processNode(next);
    }
  };

  try {
    const firstNode = flowData.nodes[0];
    if (firstNode) processNode(firstNode.id);
  } catch (err) {
    console.error('Flow generation error:', err && err.message ? err.message : err);
  }

  output.push({ section: 'Global AI Rules', instructions: GLOBAL_RULES });
  output.push({ section: 'Global AI Instructions', instructions: GLOBAL_INSTRUCTIONS });
  return output;
};

module.exports = generateDynamicFlowData;

















  

















  

