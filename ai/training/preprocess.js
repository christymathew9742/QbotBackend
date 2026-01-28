const Slots = require("../../models/Slots");
const { stripHtml, extractField, validateInput, getInputFormat } = require("../../utils/common");

const timeFormatterShort = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const timeFormatterLong = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });
const formatTime = (dateObj) => timeFormatterLong.format(dateObj);
const formatTimeShort = (dateObj) => timeFormatterShort.format(dateObj);
const formatDate = (dateString) => dateFormatter.format(new Date(dateString));
const flowCache = new WeakMap();

const HEADER_TIME_RANGE_VALUE = 'Select Time Range';
const HEADER_SPECIFIC_TIME_VALUE = 'Select Specific Time';

const countActiveSlots = async (userId, flowId, nodeId) => {
    if (!userId || !flowId) return 0;
    try {
        const count = await Slots.countDocuments({
            flowId: flowId,
            user: userId,
            SlotId: nodeId,
            status: { $in: ['booked', 'underProcess'] }
        });
        return count;
    } catch (error) {
        console.error("Error counting active slots:", error);
        return 0;
    }
};

const getBookedSlotStrings = async (userId, flowId) => {
    try {
        const bookedDocs = await Slots.find({
            user: userId,
            flowId: flowId,
            status: { $in: ['booked', 'underProcess'] }
        })
        .select('slot -_id')
        .lean(); 

        return bookedDocs.map(doc => doc.slot);

    } catch (error) {
        console.error("Error fetching booked slots:", error);
        return [];
    }
};

const generateCommonSlotOptions = async (slotsData = [], userId, flowId) => {

    if (!Array.isArray(slotsData) || slotsData.length === 0) return [];
    const promises = [];

    const result = [{
        id: `HEADER_1`,
        value: HEADER_TIME_RANGE_VALUE,
        type: 'List',
        disabled: true
    }];

    for (const dateItem of slotsData) {
        if (!Array.isArray(dateItem?.slots)) continue;
        const formattedDate = formatDate(dateItem.date);

        for (const s of dateItem.slots) {
            const start = new Date(s.start);
            const end = new Date(s.end);
            const startMs = start.getTime();
            const endMs = end.getTime();

            if (isNaN(startMs) || isNaN(endMs)) continue;

            const intervalMs = parseInt(s.interval, 10) * 60000;
            const bufferMs = parseInt(s.buffer || 0, 10) * 60000;
            let totalCapacity = 0;
            let currentCalcMs = startMs;

            while (currentCalcMs + intervalMs <= endMs) {
                totalCapacity++;
                currentCalcMs += intervalMs + bufferMs;
            }

            if (totalCapacity === 0) continue;

            promises.push(
                countActiveSlots(userId, flowId, s.id).then(slotRecordCount => ({
                    s,
                    start,
                    end,
                    startMs,
                    endMs,
                    formattedDate,
                    totalCapacity,
                    slotRecordCount
                }))
            );
        }
    }

    const calculatedSlots = await Promise.all(promises);

    for (const slotData of calculatedSlots) {
        const { s, start, end, startMs, endMs, formattedDate, totalCapacity, slotRecordCount } = slotData;

        const availableSlots = Math.max(0, totalCapacity - slotRecordCount);
        const uniqueId = `PRE-S_${s.id}_${startMs}_${endMs}_${s.interval}_${s.buffer || 0}`;

        if (availableSlots > 0) {
            result.push({
                id: uniqueId,
                value: `${formattedDate}: ${formatTimeShort(start)}-${formatTimeShort(end)}`,
                description: `${formatTime(start)} - ${formatTime(end)} (${availableSlots} Available)`,
                type: 'List',
                subSlotCount: availableSlots,
            });
        }
    }

    return result;
};

const generateSubSlotOptions = async (commonSlotId, nodeCount, userId, flowId) => {
    
    const bookedArray = await getBookedSlotStrings(userId, flowId);
    const bookedSet = new Set(bookedArray);

    const slots = [{
        id: `HEADER_2`,
        value: HEADER_SPECIFIC_TIME_VALUE, 
        type: 'List',
        disabled: true
    }];

    const parts = commonSlotId.split('_');
    if (parts.length < 6) return [];

    const SlotId = parseInt(parts[1] || '0', 10);
    const startMs = parseInt(parts[2], 10);
    const endMs = parseInt(parts[3], 10);
    const interval = parseInt(parts[4], 10);
    const buffer = parseInt(parts[5] || '0', 10);

    if (isNaN(startMs) || isNaN(endMs) || isNaN(interval) || interval <= 0) {
        console.error(`Invalid Slot Configuration: ${commonSlotId}`);
        return [];
    }

    const intervalMs = interval * 60000;
    const bufferMs = buffer * 60000;
    let currentMs = startMs;

    while (currentMs + intervalMs <= endMs) {
        const slotEndMs = currentMs + intervalMs;
        const dateStart = new Date(currentMs);
        const dateEnd = new Date(slotEndMs);
        const displayStart = formatTimeShort(dateStart);
        const displayEnd = formatTimeShort(dateEnd);
        const uniqueSubId = `PRE-SUB_${displayStart}_${displayEnd}_${currentMs}_${SlotId}-${nodeCount}`;

        if (!bookedSet.has(uniqueSubId)) {
            slots.push({
                id: uniqueSubId,
                value: `${displayStart} - ${displayEnd}`,
                description: `Starts at ${formatTime(dateStart)}`, 
                type: 'List',
            });
        }

        currentMs = slotEndMs + bufferMs;
    }

    return slots;
};

const generateOptionList = (options = [], type) => {
    if (!options || !Array.isArray(options)) return [];
    
    return options
        .filter(opt => opt?.id && stripHtml(opt?.value || '').trim().length > 0)
        .map(opt => ({
            id: `PRE-${opt.id}`,
            value: stripHtml(opt.value || '').trim(),
            type: type ?? 'text',
        }));
};

const buildFlowMaps = (nodes = [], edges = []) => {
    if (flowCache.has(nodes)) {
        return flowCache.get(nodes);
    }

    const nodeMap = new Map();
    const edgeMap = new Map();
    const incomingCount = new Map();

    for (const node of nodes) {
        nodeMap.set(node.id, node);
        if (!incomingCount.has(node.id)) incomingCount.set(node.id, 0);
    }

    for (const edge of edges) {
        if (incomingCount.has(edge.target)) {
            incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
        }
        edgeMap.set(edge.source, edge.target);
    }
    let rootNodeId = [...incomingCount.entries()].find(([_, count]) => count === 0)?.[0];

    if (!rootNodeId && nodes.length > 0) {
        rootNodeId = nodes[0].id;
    }

    const result = { nodeMap, edgeMap, rootNodeId };
    
    flowCache.set(nodes, result);
    return result;
};

const getFlowRequirements = async (
    currentStateOrHistory = null, 
    flowTrainingData = {}, 
    consultantMessage = '',
    userId,
    flowId,
) => {
    if (!flowTrainingData?.nodes?.length) return null;

    const { nodeMap, rootNodeId } = buildFlowMaps(flowTrainingData.nodes, flowTrainingData.edges);

    let state = null;
    if (currentStateOrHistory && !Array.isArray(currentStateOrHistory) && currentStateOrHistory.currentNodeId) {
        state = currentStateOrHistory;
    } else if (Array.isArray(currentStateOrHistory) && currentStateOrHistory.length > 0) {
        const last = currentStateOrHistory[currentStateOrHistory.length - 1];
        if (last?.state) state = last.state;
    }

    const currentNodeId = state ? state.currentNodeId : rootNodeId;
    const currentNode = nodeMap.get(currentNodeId);

    if (!currentNode) return null;

    const currentIndex = state?.inputIndex ?? 0;
    const inputs = currentNode?.data?.inputs ?? [];
    const nodeCount = currentNode?.data?.nodeCount ?? 0;
    const activeInput = inputs[currentIndex] ?? null;

    if (activeInput) {
        let uiOptions = '';
        let fieldName = '';

        if (activeInput.field === 'replay') {
            uiOptions = '';
            fieldName = extractField(stripHtml(activeInput?.value));
        } 
        else if (activeInput.type === 'Slot') {
            const slotOptions = state?.tempSlotSelection 
                ? await generateSubSlotOptions(state?.tempSlotSelection, nodeCount, userId, flowId) 
                : await generateCommonSlotOptions(activeInput?.slots, userId, flowId);
            uiOptions = slotOptions[0]?.value;
            fieldName = activeInput.type;
        } 
        else if (activeInput.options && activeInput.options.length > 0) {
            const listOptions = generateOptionList(activeInput.options, activeInput.type);
            uiOptions = listOptions[0]?.value;
            fieldName = uiOptions;
        } 
        else {
            fieldName = activeInput.label || activeInput.field || 'Input';
            uiOptions = activeInput.value || '';
        }

        return {
            currentNodeId,
            needsInput: true,
            fieldName: fieldName || 'Free Text',
            fieldType: activeInput.type || 'Text',
            retryCount: state?.retryCount || 0,
            isValid: validateInput(activeInput.type, consultantMessage),
            optionsLabel: uiOptions?.trim() || '',
        };
    }

    return { currentNodeId, needsInput: false };
};

const generateDynamicPrompt = async (
    currentStateOrHistory = null,
    consultantMessage = '',
    flowTrainingData = {},
    currentRetryCount = 0,
    profileName,
    userId,
    flowId,
    clearSessionFn,
    resetInputFn
) => {
    try {
        if (!flowTrainingData?.nodes?.length) {
            clearSessionFn();
            resetInputFn();
            return { reply: "Sorry, this booking is no longer active.", done: true };
        }
        const WELCOME_MESSAGE = "Hi there! I'm Eva. It’s a pleasure to assist you with your booking today. Let's get started.";
        const { nodeMap, edgeMap, rootNodeId } = buildFlowMaps(flowTrainingData.nodes, flowTrainingData.edges);
        let state = { currentNodeId: rootNodeId, collected: {}, retryCount: 0, tempSlotSelection: null, inputIndex: 0 };
        let isNewSession = true;

        if (currentStateOrHistory) {
            if (!Array.isArray(currentStateOrHistory) && currentStateOrHistory.currentNodeId) {
                state = { ...currentStateOrHistory };
                isNewSession = false;
            } else if (Array.isArray(currentStateOrHistory) && currentStateOrHistory.length > 0) {
                const last = currentStateOrHistory[currentStateOrHistory.length - 1];
                if (last?.state) {
                    state = { ...last.state };
                    isNewSession = false;
                }
            }
        }

        if (state.inputIndex === undefined) state.inputIndex = 0;

        let currentNode = nodeMap.get(state.currentNodeId) || nodeMap.get(rootNodeId);
        if (!currentNode) {
            clearSessionFn();
            resetInputFn();
            return { reply: `Sorry ${profileName}! We had a small issue processing this. Please try again 🙂`, done: true, state };
        }
        const nodeCount = currentNode?.data?.nodeCount || 0;

        if (consultantMessage && !isNewSession) {
            const nodeInputs = currentNode.data?.inputs || [];
            const activeInput = nodeInputs[state.inputIndex];
            const isInputStep = activeInput && (activeInput?.field === 'replay' || activeInput?.field === 'preference');

            if (isInputStep) {
                const replayInput = activeInput?.field === 'replay' ? activeInput : null;
                const prefInput = activeInput?.field === 'preference' ? activeInput : null;

                let nextNodeId = null;
                let validationError = null;
                let advanceIndex = false; 

                if (prefInput) {
                    const userMsg = String(consultantMessage).trim();
                    
                    if (prefInput.type === 'Slot') {
                        state.nodeCount = nodeCount;
                        if (userMsg.startsWith('PRE-S_')) {
                            const parts = userMsg.split('_');
                            const startMs = parseInt(parts[2], 10);
                            const endMs = parseInt(parts[3], 10);

                            if (!isNaN(startMs) && !isNaN(endMs)) {
                                const startDate = new Date(startMs);
                                const endDate = new Date(endMs);
                                const dateStr = `${formatDate(startDate)}: ${formatTimeShort(startDate)}-${formatTimeShort(endDate)}`;
                                stayOnNode = true;
                                state.tempSlotSelection = userMsg;
                                state.retryCount = 0;
                                state.collected[HEADER_TIME_RANGE_VALUE] = dateStr; 
                            } else {
                                stayOnNode = true;
                                validationError = "Invalid Slot Data.";
                            }
                        }  else if (userMsg.startsWith('PRE-SUB_')) {
                            stayOnNode = true;
                            state.tempSlotSelection = null;
                            state.retryCount = 0;
                            
                            const parts = userMsg.split('_');
                            const timestamp = parseInt(parts[3], 10);
                            if (!isNaN(timestamp)) {
                                const dateObj = new Date(timestamp);
                                const finalSlotStr = `${formatDate(dateObj)}, ${parts[1]} - ${parts[2]}`;
                                state.collected[HEADER_SPECIFIC_TIME_VALUE] = finalSlotStr;
                                state.isActiveSlots = true;
                                advanceIndex = true;
                            } else {
                                validationError = "Invalid Slot Timestamp.";
                            }
                        } else {
                            state.retryCount = (state.retryCount || 0) + 1;
                            validationError = "Please select a valid time slot.";
                            if (currentRetryCount > 2) {
                                validationError += `\nEG:${getInputFormat(prefInput?.type)}`;
                            }
                        }
                    } else {
                        const selectedOption = prefInput?.options?.find(opt => String(opt?.id) === String(userMsg.replace(/^PRE-/, "")));
                        if (!selectedOption) {
                            state.retryCount = (state.retryCount || 0) + 1;
                            validationError = `Please select a valid option.`;
                            if (currentRetryCount > 2) {
                                validationError += `\nEG:${getInputFormat(prefInput?.type)}`;
                            }
                        } else {
                            state.retryCount = 0;
                            state.collected[prefInput?.options[0]?.value?.trim() || 'preference'] = stripHtml(selectedOption.value);
                            const targetEdge = flowTrainingData.edges.find(e => 
                                e.source === state.currentNodeId && 
                                e.sourceHandle && 
                                String(e.sourceHandle).includes(String(selectedOption.id))
                            );

                            if (targetEdge) {
                                nextNodeId = targetEdge.target;
                            } else {
                                advanceIndex = true; 
                                stayOnNode = true;
                            }
                        }
                    }
                }  else if (replayInput) {
                    const isValid = validateInput(replayInput?.type || 'Text', consultantMessage);
                    const fieldName = extractField(stripHtml(replayInput?.value));

                    if (!isValid) {
                        state.retryCount = (state.retryCount || 0) + 1;
                        validationError = `Please ${replayInput?.type === "File" ? "send me" : "enter"} a valid ${fieldName || 'value'}.`;
                        if (fieldName && currentRetryCount > 1) {
                            validationError += `\nEG:${getInputFormat(replayInput?.type)}`;
                        }
                    } else {
                        state.retryCount = 0;
                        if (fieldName) state.collected[fieldName] = consultantMessage.trim();
                        advanceIndex = true;
                        stayOnNode = true; 
                    }
                } 

                if (validationError) {
                    return { reply: validationError, done: false, state, validationFailed: true };
                }

                if (nextNodeId) {
                    state.currentNodeId = nextNodeId;
                    state.inputIndex = 0;
                    currentNode = nodeMap.get(nextNodeId);
                } else if (advanceIndex) {
                    state.inputIndex = state.inputIndex + 1;
                }
            } 
        }

        if (!currentNode) {
            clearSessionFn();
            resetInputFn();
            return { reply: `Thank you. All required details are collected.`, done: true, state };
        }

        const nodeInputs = currentNode.data?.inputs || [];

        if (state.inputIndex >= nodeInputs.length) {
            const defaultEdge = flowTrainingData.edges.find(e => e.source === state.currentNodeId && !e.sourceHandle) 
                || flowTrainingData.edges.find(e => e.source === state.currentNodeId);
            
            if (defaultEdge) {
                state.currentNodeId = defaultEdge.target;
                state.inputIndex = 0;
                currentNode = nodeMap.get(state.currentNodeId);
            } else {
                return { reply: `Thank you. All required details are collected.`, done: true, state };
            }
        }

        const currentItem = currentNode?.data?.inputs?.[state.inputIndex];
        
        if (!currentItem) {
            return { reply: "...", done: false, state };
        }

        const messageInput = currentItem;
        const fileIds = messageInput?.fileData?.length 
            ? messageInput?.fileData.map(f => f.mId || f.fileId).filter(Boolean).join(', ')
            : '';

        let replyText = fileIds || stripHtml(messageInput?.value || '');
        replyText = replyText.replace(/\[([^\]]+)\]/g, (match, key) => {
            const val = state?.collected?.[key];
            return (val !== undefined && val !== null) ? val : match;
        });

        if (isNewSession) {
            replyText = `${WELCOME_MESSAGE},${replyText}`;
        }

        const nextPrefInput = messageInput?.field === 'preference' ? messageInput : null;
        let dynamicOptions = [];

        if (nextPrefInput) {
            if (nextPrefInput?.type === 'Slot') {
                dynamicOptions = state?.tempSlotSelection 
                    ? await generateSubSlotOptions(state?.tempSlotSelection, nodeCount, userId, flowId) 
                    : await generateCommonSlotOptions(nextPrefInput?.slots, userId, flowId);
            } else if (nextPrefInput?.options) {
                dynamicOptions = generateOptionList(nextPrefInput?.options, nextPrefInput?.type);
            }
        }

        if (messageInput.field === 'messages') {
            state.inputIndex = state.inputIndex + 1;
        }

        const hasOutgoingEdges = flowTrainingData.edges.some(e => e.source === state.currentNodeId);
        const isEndOfInputs = state.inputIndex >= (currentNode.data?.inputs?.length || 0);

        return { 
            reply: replyText, 
            options: dynamicOptions, 
            done: !hasOutgoingEdges && isEndOfInputs, 
            state 
        };

    } catch (error) {
        console.error("Flow Generation Error:", error);
        return { reply: "I encountered an error processing your request.", done: true, error: true };
    }
};

module.exports = {
    generateDynamicPrompt,
    getFlowRequirements,
    validateInput,
};

