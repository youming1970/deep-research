import { GoogleGenerativeAI } from '@google/generative-ai';
// import fetch from 'node-fetch';

// 初始化一个专用的Google AI客户端
const genAI = process.env.GOOGLE_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  : undefined;

/**
 * 模拟Gemini API响应，用于开发和测试环境
 */
function mockGeminiResponse(prompt: string): string {
  console.log("使用模拟的Gemini API响应，没有找到API密钥");
  
  // 创建一个更完整、更真实的模拟响应对象
  let mockResponseContent = {};
  
  // 根据提示内容生成适当的回应
  if (prompt.toLowerCase().includes('问题') || prompt.includes('questions')) {
    // 返回模拟的问题数组
    mockResponseContent = {
      questions: [
        "天空为什么呈现蓝色而不是其他颜色？",
        "大气层中的分子是如何影响光的散射的？",
        "在不同的天气条件下，天空的颜色会有什么变化？",
        "日出和日落时天空呈现红色的原理是什么？",
        "其他行星的\"天空\"颜色是什么样的，为什么会有差异？"
      ]
    };
  } else if (prompt.toLowerCase().includes('summary') || prompt.includes('总结')) {
    // 返回模拟的总结
    mockResponseContent = {
      summary: "这是一个关于天空为什么呈现蓝色的模拟总结。主要是因为大气中的分子散射阳光，短波长的蓝光散射得更多。这种现象被称为瑞利散射，以约翰·瑞利勋爵的名字命名，他在1871年首次解释了这一现象。大气分子优先散射较短波长的光（如蓝光和紫光），使得我们从各个方向看到的天空呈现蓝色。而日出日落时，阳光要穿过更厚的大气层，蓝光几乎完全被散射掉，只剩下红光和橙光直达我们的眼睛，因此日出日落时天空呈现红色或橙色。"
    };
  } else {
    // 默认返回更通用的对象
    mockResponseContent = {
      results: [
        {
          title: "模拟响应",
          description: "这是一个模拟的API响应，仅用于测试环境",
          importance: 0.95,
          relevance: "high"
        },
        {
          title: "API密钥缺失",
          description: "由于未找到有效的Gemini API密钥，系统生成了此模拟响应",
          importance: 0.85,
          relevance: "medium"
        }
      ],
      metadata: {
        query: prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
        timestamp: new Date().toISOString(),
        source: "mock_data"
      }
    };
  }
  
  // 将模拟内容包装在一个OpenAI兼容的响应结构中
  // 这样callGeminiAPI函数返回的数据看起来就像是真正来自API
  const mockOpenAIResponse = {
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify(mockResponseContent, null, 2)
        },
        finish_reason: "stop"
      }
    ],
    id: `mock-gemini-${Date.now()}`,
    model: "gemini-1.5-flash-mock",
    created: Math.floor(Date.now() / 1000),
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 4),
      completion_tokens: 200,
      total_tokens: Math.ceil(prompt.length / 4) + 200
    }
  };
  
  // 只返回内容部分，模拟真实API的行为
  return mockOpenAIResponse.choices[0]?.message?.content || "{}";
}

/**
 * 调用 Gemini API 生成响应
 * 使用 OpenAI 兼容方式
 */
async function callGeminiAPI(
  prompt: string,
  system?: string,
  temperature?: number,
  modelId?: string // 接收 modelId 参数
): Promise<string> {
  console.log("Calling Gemini API with prompt:", prompt.substring(0, 100) + "...");
  
  // 使用 API KEY，优先使用环境变量中的 GEMINI_API_KEY，其次使用 GOOGLE_API_KEY
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  
  // 开发环境下，没有API密钥时使用模拟响应
  if (!apiKey) {
    console.warn('No API key found for Gemini API. Using mock response for development.');
    return mockGeminiResponse(prompt);
  }
  
  // 使用 modelId 参数，如果未提供则使用默认值 'gemini-1.5-flash'
  const genAI = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelId || 'gemini-1.5-flash' });
  
  // 构建消息
  const messages = [];
  
  // 添加系统提示，如果有的话
  if (system) {
    // 增强系统提示，明确要求生成 JSON
    const enhancedSystem = `${system}\n\nIMPORTANT: When asked to generate JSON, your response MUST be a valid, properly formatted JSON object ONLY, with no additional text before or after the JSON. Do not include markdown formatting, explanations, or any text that isn't part of the JSON object.`;
    messages.push({ role: "system", content: enhancedSystem });
  } else {
    // 如果没有系统提示，添加一个默认的关于 JSON 格式的系统提示
    messages.push({ 
      role: "system", 
      content: "You are a helpful assistant that provides information in JSON format when requested. Your JSON responses must be valid, properly formatted JSON objects ONLY, with no additional text before or after the JSON. Do not include markdown formatting, explanations, or any text that isn't part of the JSON object."
    });
  }
  
  // 添加用户提示
  messages.push({ role: "user", content: prompt });
  
  // 重试配置
  const maxRetries = 3; // 最大重试次数
  let retryDelay = 1000; // 初始重试延迟 (毫秒)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 使用 OpenAI 兼容端点调用 Gemini API
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelId || 'gemini-1.5-flash',
          messages: messages,
          temperature: temperature
        })
      });
      
      // 检查HTTP状态码
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          // 遇到 429 错误，进行重试
          if (attempt < maxRetries) {
            console.warn(`Gemini API 速率限制 (429)! ${attempt + 1}/${maxRetries} 次重试，等待 ${retryDelay / 1000} 秒...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay *= 2; // 指数退避：每次重试延迟翻倍
            continue; // 进入下一次循环，重试
          } else {
            // 达到最大重试次数，抛出错误
            console.error(`Gemini API 达到最大重试次数后仍然失败 (429)! 状态: ${response.status}`, errorText);
            throw new Error(`Gemini API 速率限制错误 (429) - 达到最大重试次数`);
          }
        } else {
          // 其他非 429 错误，立即抛出错误
          console.error(`Gemini API HTTP 错误! 状态: ${response.status}`, errorText);
          throw new Error(`HTTP 错误! 状态: ${response.status}`);
        }
      }
      
      // 解析响应
      const data = await response.json();
      
      // 添加日志，记录Gemini API的原始响应结构
      console.log('Gemini API 原始响应结构:', JSON.stringify(data, null, 2));
      
      // 提取文本响应
      if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
        console.log('API response structure:', JSON.stringify({ choices: data.choices.map((c: any) => ({ message: { role: c.message.role, content_length: c.message.content.length } })) }, null, 2));
        return data.choices[0].message.content;
      } else {
        console.error('Unexpected response structure from Gemini API:', JSON.stringify(data, null, 2));
        throw new Error('Unexpected response structure from Gemini API');
      }
    } catch (error: any) {
      console.error('Error calling Gemini API:', error);
      
      // 对于非429错误或已经最大重试次数的429错误，直接抛出
      if (error.message === 'Gemini API 速率限制错误 (429) - 达到最大重试次数' || attempt >= maxRetries) {
        throw error;
      }
      
      // 其他错误也进行重试
      console.warn(`Gemini API 调用出错! ${attempt + 1}/${maxRetries} 次重试，等待 ${retryDelay / 1000} 秒... 错误信息: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retryDelay *= 2; // 指数退避：每次重试延迟翻倍
    }
  }
  
  // 理论上不应该执行到这里，因为循环中成功返回或抛出错误
  throw new Error("Gemini API 调用失败，已达到最大重试次数");
}

/**
 * 清理 API 返回的响应，提取有效的 JSON
 */
function cleanResponse(response: string): string {
  console.log("Cleaning raw response...");
  
  if (!response || typeof response !== 'string') {
    console.warn("Invalid response to clean:", response);
    return '{}';
  }
  
  // 尝试查找 JSON 对象的起始和结束位置
  let cleanedResponse = response.trim();
  
  // 处理Markdown代码块
  // Gemini倾向于将JSON包装在Markdown代码块中
  // 完整检测并提取JSON代码块内容
  const jsonBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/;
  const jsonBlockMatch = cleanedResponse.match(jsonBlockRegex);
  
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    // 提取代码块内容
    cleanedResponse = jsonBlockMatch[1].trim();
    console.log("提取Markdown代码块中的JSON内容");
  }
  
  // 进一步清理 - 移除控制字符和非法JSON字符
  // 1. 移除所有控制字符（ASCII 0-31，除了制表符、换行符和回车）
  cleanedResponse = cleanedResponse.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // 尝试解析完整的响应作为JSON
  try {
    // 验证是否为完整有效的JSON
    const result = JSON.parse(cleanedResponse);
    console.log("响应已经是有效的JSON");
    return cleanedResponse;
  } catch (e) {
    // 不是有效的JSON，继续处理
    console.log("响应不是有效的JSON，继续尝试提取...");
  }
  
  // 尝试找到并提取 JSON 对象
  const jsonStartIndex = cleanedResponse.indexOf('{');
  const jsonEndIndex = cleanedResponse.lastIndexOf('}') + 1;
  
  if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
    try {
      const jsonText = cleanedResponse.substring(jsonStartIndex, jsonEndIndex);
      // 验证提取的文本是否为有效的 JSON
      JSON.parse(jsonText);
      console.log("成功提取并验证JSON对象");
      return jsonText;
    } catch (e) {
      console.warn("Failed to extract valid JSON:", e);
      
      // JSON解析失败，尝试更激进的清理方法
      try {
        // 获取提取的JSON文本
        let jsonText = cleanedResponse.substring(jsonStartIndex, jsonEndIndex);
        
        // 修复常见的JSON语法问题
        // 1. 确保所有引号是双引号，且正确转义
        jsonText = jsonText.replace(/'/g, '"');
        
        // 2. 修复未转义的引号
        jsonText = jsonText.replace(/(?<!")(")(?!")/g, '\\"');
        
        // 3. 修复多余的逗号，如 {a: 1, b: 2,}
        jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');
        
        // 4. 移除所有控制字符
        jsonText = jsonText.replace(/[\x00-\x1F\x7F]/g, '');
        
        // 5. 确保属性名有双引号 (从 {a:1} 到 {"a":1})
        jsonText = jsonText.replace(/([{,]\s*)([a-zA-Z0-9_$]+)(\s*:)/g, '$1"$2"$3');
        
        // 尝试解析修复后的JSON
        JSON.parse(jsonText);
        console.log("Successfully fixed and parsed JSON after aggressive cleaning");
        return jsonText;
      } catch (e2) {
        console.warn("Failed to fix JSON even after aggressive cleaning:", e2);
      }
    }
  }
  
  // 尝试一个更简单的解决方案：如果原始响应包含一个看起来像JSON的结构，
  // 直接构造一个新的干净JSON
  try {
    // 使用正则表达式查找消息和项目内容
    const messageMatch = response.match(/"message"\s*:\s*"([^"]+)"/);
    const itemsMatch = response.match(/"items"\s*:\s*\[([\s\S]*?)\]/);
    
    if (messageMatch && messageMatch[1] && itemsMatch && itemsMatch[1]) {
      const message = messageMatch[1].replace(/"/g, '\\"');
      
      // 提取items数组内容
      const itemsContent = itemsMatch[1];
      // 清理items内容，确保每个项目是正确的字符串格式
      const itemsArray = itemsContent
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .map(item => {
          // 移除开头和结尾的引号，然后添加新的引号
          item = item.trim();
          if ((item.startsWith('"') && item.endsWith('"')) || 
              (item.startsWith("'") && item.endsWith("'"))) {
            item = item.substring(1, item.length - 1);
          }
          return `"${item.replace(/"/g, '\\"')}"`;
        });
      
      // 构建新的干净JSON
      const newJson = `{"message":"${message}","items":[${itemsArray.join(',')}]}`;
      
      // 验证新构建的JSON
      JSON.parse(newJson);
      console.log("成功构建新的干净JSON");
      return newJson;
    }
  } catch (e) {
    console.warn("构建新JSON失败:", e);
  }
  
  // 最后的尝试：直接从原始文本中提取看起来像键值对的内容
  try {
    const potentialMatches = [...response.matchAll(/"([^"]+)"\s*:\s*("[^"]*"|[0-9]+|\[[^\]]*\])/g)];
    
    if (potentialMatches.length > 0) {
      const extractedPairs = potentialMatches.map(match => `"${match[1]}":${match[2]}`);
      const constructedJson = `{${extractedPairs.join(',')}}`;
      
      // 尝试解析构造的JSON
      JSON.parse(constructedJson);
      console.log("成功从文本中提取键值对构建JSON");
      return constructedJson;
    }
  } catch (e) {
    console.warn("从文本提取键值对失败:", e);
  }
  
  // 所有JSON提取和修复尝试都失败
  // 返回一个安全的空JSON对象
  console.warn("所有JSON提取方法都失败，返回空对象");
  return '{}';
}

/**
 * 使用Gemini API生成回答
 */
export async function generateWithGemini(options: {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonOutput?: boolean;
  schema?: any;
}): Promise<{ text: string; usage: any }> {
  try {
    const { prompt, system, model = 'gemini-1.5-flash', temperature = 0.7, jsonOutput, schema } = options;
    
    if (!genAI) {
      throw new Error('Google API client not initialized - missing API key');
    }
    
    // 获取Gemini模型
    const geminiModel = genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature
      }
    });
    
    // 构建消息
    const messages = [];
    if (system) {
      // Gemini没有system角色，添加为用户消息
      messages.push({
        role: 'user',
        parts: [{ text: system }]
      });
    }
    
    // 添加用户提示
    let userPrompt = prompt;
    if (jsonOutput) {
      // 如果需要JSON输出，添加指令
      userPrompt += '\n\nPlease respond with a valid JSON object';
      if (schema) {
        userPrompt += ` that conforms to this schema: ${JSON.stringify(schema, null, 2)}`;
      }
      userPrompt += '\nYour response must be ONLY A JSON OBJECT with no additional text, no markdown formatting, and valid JSON.';
    }
    
    messages.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });
    
    // 创建聊天会话或使用简单生成
    const chat = geminiModel.startChat({
      history: messages.slice(0, -1)
    });
    
    // 发送最后一条消息
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !lastMessage.parts[0]) {
      throw new Error('Invalid message format');
    }
    
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    let responseText = result.response.text();
    
    // 如果需要JSON输出，尝试处理响应
    if (jsonOutput) {
      try {
        // 尝试提取并验证JSON
        const jsonStartIndex = responseText.indexOf('{');
        const jsonEndIndex = responseText.lastIndexOf('}') + 1;
        
        if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
          const jsonText = responseText.substring(jsonStartIndex, jsonEndIndex);
          // 验证JSON
          JSON.parse(jsonText);
          responseText = jsonText;
        }
      } catch (e) {
        console.warn('Failed to extract valid JSON:', e);
      }
    }
    
    // 估算token使用量
    const promptLength = (system || '').length + prompt.length;
    const responseLength = responseText.length;
    
    return {
      text: responseText,
      usage: {
        promptTokens: Math.ceil(promptLength / 4),
        completionTokens: Math.ceil(responseLength / 4),
        totalTokens: Math.ceil((promptLength + responseLength) / 4)
      }
    };
  } catch (error) {
    console.error('Error using Gemini API:', error);
    return {
      text: 'Error: Failed to generate response with Gemini API',
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2
      }
    };
  }
}

/**
 * 创建符合schema的默认JSON对象
 */
function createDefaultObjectFromSchema(schema: any): any {
  // 如果schema是一个对象描述
  if (schema.type === 'object' && schema.properties) {
    const result: any = {};
    
    // 遍历属性
    Object.keys(schema.properties).forEach(key => {
      const propSchema = schema.properties[key];
      
      // 根据属性类型创建默认值
      if (propSchema.type === 'string') {
        result[key] = propSchema.description || `Default ${key}`;
      } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
        result[key] = 0;
      } else if (propSchema.type === 'boolean') {
        result[key] = false;
      } else if (propSchema.type === 'array') {
        // 对于数组，创建一个元素的默认数组
        if (propSchema.items && propSchema.items.type === 'string') {
          result[key] = [propSchema.items.description || `Default item for ${key}`];
        } else if (propSchema.items && propSchema.items.type === 'object') {
          result[key] = [createDefaultObjectFromSchema(propSchema.items)];
        } else {
          result[key] = [];
        }
      } else if (propSchema.type === 'object') {
        result[key] = createDefaultObjectFromSchema(propSchema);
      } else {
        result[key] = null;
      }
    });
    
    return result;
  }
  
  // 返回空对象作为默认值
  return {};
}

/**
 * 使用Gemini API生成JSON对象，改进版
 */
export async function generateJsonWithGemini({
  prompt,
  system,
  schema,
  temperature = 0.7,
  modelId // 接收 modelId 参数
}: {
  prompt: string;
  system: string;
  schema?: any;
  temperature?: number;
  modelId: string; // 声明 modelId 参数类型
}): Promise<any> {
  if (!prompt || typeof prompt !== 'string') {
    console.error('Invalid prompt type in generateJsonWithGemini:', typeof prompt, prompt);
    throw new Error('Invalid prompt provided');
  }

  if (system !== undefined && typeof system !== 'string') {
    console.error('Invalid system type in generateJsonWithGemini:', typeof system, system);
    throw new Error('Invalid system prompt provided');
  }

  try {
    // 准备schema描述
    let schemaDescription = '';
    
    if (schema) {
      // 处理不同类型的schema
      if (typeof schema.describe === 'function') {
        // Zod schema with describe method
        schemaDescription = JSON.stringify(schema.describe(), null, 2);
      } else if (typeof schema === 'object' && schema !== null) {
        if (schema.$schema) {
          // JSON Schema
          schemaDescription = JSON.stringify(schema, null, 2);
        } else if (schema.type || schema.properties) {
          // 简化的JSON Schema或类似结构
          schemaDescription = JSON.stringify(schema, null, 2);
        } else {
          // 尝试以其他方式提取schema信息
          schemaDescription = JSON.stringify(schema, null, 2);
        }
      }
      
      console.log('Schema description (first 200 chars):', 
        schemaDescription.substring(0, 200) + (schemaDescription.length > 200 ? '...' : ''));
    }
    
    // 构建最终提示，添加JSON指令
    let finalPrompt = prompt;
    
    // 如果有schema，将其添加到提示中
    if (schemaDescription) {
      finalPrompt += `\n\nYour response MUST be a valid JSON object and nothing else.\nThe JSON structure should follow this schema:\n${schemaDescription}\n\nIMPORTANT: Do not include any text before or after the JSON. The response must be valid JSON parseable by JSON.parse(). Do not include control characters or special characters that would break JSON parsing. For string values, ensure that quotes and backslashes are properly escaped.`;
    } else {
      finalPrompt += '\n\nYour response MUST be a valid JSON object and nothing else. Do not include any text before or after the JSON. Ensure all quotes and special characters are properly escaped.';
    }
    
    console.log('Final prompt type:', typeof finalPrompt);
    
    // 调用Gemini API，最多重试3次
    let response = '';
    let retryCount = 0;
    const MAX_RETRIES = 3;
    
    while (retryCount < MAX_RETRIES) {
      try {
        console.log(`尝试调用Gemini API (尝试 ${retryCount + 1}/${MAX_RETRIES})...`);
        response = await callGeminiAPI(finalPrompt, system, temperature, modelId);
        break; // 成功获取响应，跳出循环
      } catch (apiError) {
        retryCount++;
        console.error(`Gemini API调用失败 (尝试 ${retryCount}/${MAX_RETRIES}):`, apiError);
        
        if (retryCount >= MAX_RETRIES) {
          console.error('已达到最大重试次数，放弃尝试');
          throw apiError; // 已达到最大重试次数，向上抛出错误
        }
        
        // 指数退避等待
        const waitTime = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s...
        console.log(`等待 ${waitTime}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!response) {
      console.error('Gemini API返回空响应');
      // 尝试返回基于schema的默认对象，而不是空对象
      return schema ? createDefaultObjectFromSchema(schema) : {};
    }
    
    // 打印原始响应的样本进行分析
    console.log('Gemini API 原始响应样本 (前100字符):', 
      response.substring(0, 100) + (response.length > 100 ? '...' : ''));
    
    // 检查响应中是否包含控制字符
    const hasControlChars = /[\x00-\x1F\x7F]/.test(response);
    if (hasControlChars) {
      console.warn('警告: 检测到原始响应中包含控制字符，可能导致JSON解析错误');
      console.log('包含控制字符的位置:', [...response.matchAll(/[\x00-\x1F\x7F]/g)].map(m => m.index));
    }
    
    // 清理响应并转换为JSON
    const cleanedResponse = cleanResponse(response);
    console.log('清理后的响应 (前100个字符):', 
      cleanedResponse.substring(0, 100) + (cleanedResponse.length > 100 ? '...' : ''));
    
    try {
      // 尝试解析JSON
      const jsonResult = JSON.parse(cleanedResponse);
      console.log('成功解析JSON结果:', 
        JSON.stringify(jsonResult, null, 2).substring(0, 200) + 
        (JSON.stringify(jsonResult, null, 2).length > 200 ? '...' : ''));
      
      // 验证结果是否为空对象
      if (Object.keys(jsonResult).length === 0) {
        console.warn('警告: 解析的JSON结果是空对象 {}');
        
        // 如果有schema，尝试返回基于schema的默认对象
        if (schema) {
          console.log('尝试基于schema创建默认对象');
          const defaultObj = createDefaultObjectFromSchema(schema);
          if (Object.keys(defaultObj).length > 0) {
            console.log('使用基于schema的默认对象:', JSON.stringify(defaultObj, null, 2));
            return defaultObj;
          }
        }
      }
      
      return jsonResult;
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError);
      
      // 记录详细的错误信息和响应数据，以便进一步分析
      console.error('Raw response length:', response.length);
      console.error('Cleaned response length:', cleanedResponse.length);
      
      // 检查错误类型
      if (parseError instanceof SyntaxError) {
        console.error('JSON语法错误:', parseError.message);
        
        // 如果错误消息包含位置信息，显示该位置附近的内容
        const positionMatch = parseError.message.match(/position (\d+)/);
        if (positionMatch && positionMatch[1]) {
          const position = parseInt(positionMatch[1]);
          const start = Math.max(0, position - 20);
          const end = Math.min(cleanedResponse.length, position + 20);
          console.error(`位置 ${position} 附近的内容:`, 
            JSON.stringify(cleanedResponse.substring(start, end)));
          
          // 尝试使用更简单的方法提取有效的JSON部分
          console.log('尝试使用更简单的方法获取JSON...');
          try {
            // 仅保留字母、数字、标点符号和基本符号
            const simplifiedJson = cleanedResponse.replace(/[^\w\s\{\}\[\]"':,.-]/g, '');
            const jsonResult = JSON.parse(simplifiedJson);
            console.log('使用简化方法成功解析JSON');
            return jsonResult;
          } catch (e) {
            console.error('简化方法也失败了:', e);
          }
        }
      }
      
      // 如果有schema，尝试返回基于schema的默认对象，而不是空对象
      if (schema) {
        console.log('JSON解析失败 - 尝试基于schema创建默认对象');
        return createDefaultObjectFromSchema(schema);
      }
      
      // 返回空对象以防止更多错误
      return {};
    }
  } catch (error) {
    console.error('Error generating JSON with Gemini:', error);
    
    // 如果有schema，尝试返回基于schema的默认对象，而不是空对象
    if (schema) {
      console.log('发生错误 - 尝试基于schema创建默认对象');
      return createDefaultObjectFromSchema(schema);
    }
    
    // 返回空对象以防止进一步报错
    return {};
  }
}

// ... existing code ...

// ... existing code ... 