interface LookupTables {
  agentVariables: Record<string, string>;
  agentInputs: Record<string, string>;
  skills: Record<string, string>;
  agentReferenceVariables: Record<string, string>;
}

/**
 * Builds lookup tables for variables, inputs, and skills, matching Python build_lookup_tables logic.
 */
function buildLookupTables(data: any): LookupTables {
  const lookups: LookupTables = { 
    agentVariables: {}, 
    agentInputs: {}, 
    skills: {}, 
    agentReferenceVariables: {} 
  };
  
  // 1. Agent Variables
  (data?.agentVariables || []).forEach((item: any) => {
    const slug = item.slug;
    const name = item.name || 'Unknown Variable';
    const desc = item.description || '';
    if (slug) {
      lookups.agentVariables[slug] = desc ? `${name} (${desc})` : name;
    }
  });

  // 2. Agent Inputs
  (data?.agentInputs || []).forEach((item: any) => {
    const slug = item.slug;
    const name = item.name || 'Unknown Input';
    const desc = item.description || '';
    if (slug) {
      lookups.agentInputs[slug] = desc ? `${name} (${desc})` : name;
    }
  });

  // 3. Agent Reference Variables
  (data?.agentReferenceVariables || []).forEach((item: any) => {
    const id = item._id;
    const refSlug = item.referencedSlug;
    if (id && refSlug) {
      // Map the _id to the description of the referenced slug
      const desc = lookups.agentVariables[refSlug] || lookups.agentInputs[refSlug];
      if (desc) {
        lookups.agentReferenceVariables[id] = desc;
      } else {
        lookups.agentReferenceVariables[id] = `Reference to ${refSlug}`;
      }
    }
  });

  // 4. Skills (extracted from conversations)
  (data?.dynamicConversation || []).forEach((convo: any) => {
    if (convo.skills?.config) {
      Object.keys(convo.skills.config).forEach(skillSlug => {
        lookups.skills[skillSlug] = skillSlug;
      });
    }
  });

  return lookups;
}

/**
 * Recursively parses the prose mirror content structure, matching Python parse_step_content logic.
 */
function parseStepContent(contentNode: any, usedIds: Set<string>): string {
  let textOutput = "";
  
  if (Array.isArray(contentNode)) {
    for (const item of contentNode) {
      textOutput += parseStepContent(item, usedIds);
    }
    return textOutput;
  }

  const nodeType = contentNode?.type;
  if (!nodeType) return "";

  if (nodeType === 'doc' || nodeType === 'paragraph') {
    if (contentNode.content) {
      textOutput += parseStepContent(contentNode.content, usedIds);
    }
    if (nodeType === 'paragraph') {
      textOutput += "\n"; // Add newline after paragraphs
    }
  } else if (nodeType === 'text') {
    textOutput += contentNode.text || '';
  } else if (nodeType === 'hardBreak') {
    textOutput += "\n";
  } else if (nodeType === 'tag') {
    const attrs = contentNode.attrs || {};
    const tagSubType = attrs.tagSubType;
    const value = attrs.value;
    
    if (value) {
      textOutput += ` [${tagSubType}: ${value}] `;
      usedIds.add(`${tagSubType}|${value}`);
    }
  }

  return textOutput;
}

/**
 * Generates a comprehensive bot summary from the raw JSON data, matching Python generate_summary logic.
 */
export function generateBotSummary(rawData: any): string {
  // Ultra-robust structure detector for Yellow.ai exports matching extract_bot_data.py
  let coreData = rawData;
  if (rawData?.data?.data) coreData = rawData.data.data;
  else if (rawData?.data) coreData = rawData.data;

  const extracted = {
    dynamicConversation: coreData?.dynamicConversation || [],
    agentVariables: coreData?.agentVariables || [],
    agentInputs: coreData?.agentInputs || [],
    agentReferenceVariables: coreData?.agentReferenceVariables || [],
    systemAgent: coreData?.systemAgent || [],
  };

  const lookups = buildLookupTables(extracted);
  let output = "";
  const globalUsedIds = new Set<string>();

  // 1. Dynamic Conversation Extraction
  extracted.dynamicConversation.forEach((convo: any) => {
    // Agent Name (Title)
    const title = convo.title || 'Untitled Agent';
    output += `Agent Name: ${title}\n`;
    output += "=".repeat(title.length + 12) + "\n\n";

    // Rules
    output += "Rules:\n";
    output += "-".repeat(6) + "\n";
    const rules = convo.rules || [];
    rules.forEach((rule: any, idx: number) => {
      const instruction = rule.instruction || '';
      output += `${idx + 1}. ${instruction}\n`;
    });
    output += "\n";

    // Steps
    output += "Goal Steps:\n";
    output += "-".repeat(11) + "\n";
    const goal = convo.goal || {};
    const steps = goal.steps || [];
    
    steps.forEach((step: any, idx: number) => {
      const instruction = step.instruction || {};
      if (instruction.type === 'editorContent') {
        const stepText = parseStepContent(instruction.value, globalUsedIds);
        // Step numbers removed as requested to streamline AI ingestion
        output += `${stepText}\n`;
      }
    });

    output += "\n" + "#".repeat(50) + "\n\n";
  });

  // 2. System Agent Extraction
  extracted.systemAgent.forEach((sa: any) => {
    // Title
    const title = sa.title || 'System Agent';
    output += `System Agent Name: ${title}\n`;
    output += "=".repeat(title.length + 20) + "\n\n";

    // Trigger
    const trigger = sa.trigger || 'No trigger defined.';
    output += `Trigger:\n${trigger}\n\n`;

    // Instructions
    output += "Instructions:\n";
    output += "-".repeat(13) + "\n";

    // FollowUp Instruction
    const followUp = sa.followUp || {};
    if (followUp.enabled) {
      const instruction = followUp.instruction || {};
      if (instruction.type === 'editorContent') {
        const text = parseStepContent(instruction.value, globalUsedIds);
        output += `Follow-Up Instruction:\n${text}\n`;
      }
    }

    // Summarisation Instruction/Content
    const summarisation = sa.summarisation || {};
    const instruction = summarisation.instruction || {};
    if (instruction.type === 'editorContent') {
      const text = parseStepContent(instruction.value, globalUsedIds);
      output += `Summarisation Content:\n${text}\n`;
    }
    
    output += "\n" + "#".repeat(50) + "\n\n";
  });

  // 3. Global Reference Descriptions
  output += "Reference Descriptions:\n";
  output += "-".repeat(22) + "\n";
  
  if (globalUsedIds.size === 0) {
    output += "No references found in steps.\n";
  } else {
    // Sort for consistent output
    const sortedIds = Array.from(globalUsedIds).sort((a, b) => {
      const [typeA, valA] = a.split('|');
      const [typeB, valB] = b.split('|');
      if (typeA < typeB) return -1;
      if (typeA > typeB) return 1;
      return valA.localeCompare(valB);
    });
    
    sortedIds.forEach(idStr => {
      const [tagSubType, value] = idStr.split('|');
      let description = "Description not found";
      
      // Try to find in lookups based on tag type
      if (tagSubType === 'agentInput') {
        description = lookups.agentInputs[value] || description;
      } else if (tagSubType === 'agentVariable') {
        description = lookups.agentVariables[value] || description;
      } else if (tagSubType === 'call_skill') {
        description = lookups.skills[value] || value; 
      } else if (tagSubType === 'get_input') {
        if (lookups.agentInputs[value]) {
          description = lookups.agentInputs[value];
        } else if (lookups.agentVariables[value]) {
          description = lookups.agentVariables[value];
        }
      }
      
      // Final Fallback Search
      if (description === "Description not found") {
        description = lookups.agentInputs[value] || 
                      lookups.agentVariables[value] || 
                      lookups.skills[value] || 
                      lookups.agentReferenceVariables[value] || 
                      description;
      }

      output += `[${tagSubType}] ${value}: ${description}\n`;
    });
  }

  return output;
}