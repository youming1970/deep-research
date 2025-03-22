import { GoogleGenerativeAI } from '@google/generative-ai';
// 自定义消息类型，而不是使用ai库的Message类型
export type SimpleMessage = {
  role: string;
  content: string | any[];
};

import { generateJsonWithGemini, generateWithGemini } from './gemini-helper';
import { z } from 'zod';
import { systemPrompt } from '../prompt';

// 初始化一个专用的Google AI客户端
const genAI = process.env.GOOGLE_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  : undefined;

/**
 * 创建一个直接使用Google Gemini API的模型适配器
 * 该方法将原始的Gemini API调用转换为与AI库兼容的格式
 */
export async function callGeminiDirectly(options: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  responseFormat?: { type: string; schema?: any };
}) {
  try {
    const { model, messages, temperature = 0.7, responseFormat } = options;
    
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
    
    // 将OpenAI格式的消息转换为Gemini格式
    const geminiMessages = messages.map(msg => ({
      role: msg.role === 'system' ? 'user' : msg.role, // Gemini没有system角色
      parts: [{ text: msg.content }]
    }));
    
    // 确保有消息
    if (geminiMessages.length === 0) {
      throw new Error('No messages provided');
    }
    
    // 准备最后一条消息文本
    let promptText = "";
    const lastMessage = geminiMessages[geminiMessages.length - 1];
    if (!lastMessage || !lastMessage.parts[0]) {
      throw new Error('Invalid last message format');
    }
    
    // 如果需要结构化JSON输出，添加相关指令
    if (responseFormat && responseFormat.type === 'json_object') {
      const schemaText = responseFormat.schema 
        ? `\n\nUse this exact JSON schema: ${JSON.stringify(responseFormat.schema)}` 
        : '';
      
      promptText = `${lastMessage.parts[0].text}\n\nYour response must be formatted as a JSON object that can be parsed by JSON.parse()${schemaText}`;
    } else {
      promptText = lastMessage.parts[0].text;
    }
    
    // 创建聊天会话
    const chat = geminiModel.startChat({
      history: geminiMessages.slice(0, -1)
    });
    
    // 发送带有特殊指令的消息
    const result = await chat.sendMessage(promptText);
    let responseText = result.response.text();
    
    // 如果是JSON格式，尝试确保返回的是有效JSON
    if (responseFormat && responseFormat.type === 'json_object') {
      // 尝试从响应中提取JSON
      try {
        // 找到JSON的开始和结束位置
        const jsonStartIndex = responseText.indexOf('{');
        const jsonEndIndex = responseText.lastIndexOf('}') + 1;
        
        if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
          // 提取JSON部分
          const jsonText = responseText.substring(jsonStartIndex, jsonEndIndex);
          // 验证JSON是否有效
          JSON.parse(jsonText);
          responseText = jsonText;
        } else {
          console.warn('Could not extract valid JSON from response');
        }
      } catch (e) {
        console.warn('Failed to parse JSON response:', e);
      }
    }
    
    // 计算一个估计的token数量
    const estimatedPromptTokens = messages.reduce((acc, msg) => acc + (msg.content.length / 4), 0);
    const estimatedResponseTokens = responseText.length / 4;
    
    return {
      content: responseText,
      // 添加模拟的usage对象，解决token计算错误
      usage: {
        promptTokens: Math.ceil(estimatedPromptTokens),
        completionTokens: Math.ceil(estimatedResponseTokens),
        totalTokens: Math.ceil(estimatedPromptTokens + estimatedResponseTokens)
      }
    };
  } catch (error) {
    console.error('Error calling Gemini directly:', error);
    throw error;
  }
}

/**
 * 创建Gemini模型实例
 */
export function createGeminiModel(modelId: string) {
  return {
    modelId: modelId || 'gemini-1.5-flash',
    provider: 'google',
    specificationVersion: 'v1',
    structuredOutputs: true,
    defaultObjectGenerationMode: 'json',
    
    // 基本文本生成
    async invoke(params: { messages: SimpleMessage[]; temperature?: number }) {
      console.log(`Invoking Gemini model ${this.modelId} with ${params.messages.length} messages`);
      
      // 找出最后一条用户消息
      const userMsgs = params.messages.filter(msg => msg.role === 'user');
      if (userMsgs.length === 0) {
        throw new Error('No user message found in the messages array');
      }
      
      // 添加非空断言，因为我们已经检查了数组长度
      const lastUserMsg = userMsgs[userMsgs.length - 1]!;
      let prompt = '';
      
      // 提取用户消息内容
      if (typeof lastUserMsg.content === 'string') {
        prompt = lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg.content)) {
        // 使用类型断言确保TypeScript知道这是内容数组
        const contentArray = lastUserMsg.content as Array<{type: string; text?: string}>;
        const textParts = contentArray
          .filter(part => part.type === 'text' && typeof part.text === 'string')
          .map(part => part.text as string);
        prompt = textParts.join('\n');
      }
      
      // 提取系统消息作为system prompt
      const systemMsg = params.messages.find(msg => msg.role === 'system');
      let system = systemMsg && typeof systemMsg.content === 'string' 
        ? systemMsg.content 
        : undefined;
      
      if (!prompt) {
        throw new Error('Failed to extract valid prompt from user message');
      }
      
      try {
        // 生成响应
        const { text, usage } = await generateWithGemini({
          prompt,
          system,
          model: this.modelId,
          temperature: params.temperature
        });
        
        // 构建返回对象
        return {
          response: {
            id: `gemini-${Date.now()}`,
            modelId: this.modelId,
            timestamp: new Date().toISOString(),
            usage: {
              promptTokens: usage.promptTokens || 0,
              completionTokens: usage.completionTokens || 0,
              totalTokens: usage.totalTokens || 0
            }
          },
          text
        };
      } catch (error: any) {
        console.error('Gemini invoke error:', error);
        const errorDetail = error.message || 'Unknown error';
        return {
          response: {
            id: `gemini-error-${Date.now()}`,
            modelId: this.modelId,
            timestamp: new Date().toISOString(),
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          },
          text: `Error: ${errorDetail}`
        };
      }
    },
    
    // 生成结构化输出
    async doGenerate(params: {
      messages?: SimpleMessage[];
      prompt?: string | {role: string; content: string | any[]}[];
      system?: string;
      schema?: any;
      mode?: {type: string; schema?: any};
      temperature?: number;
    }) {
      try {
        // 调用内部的 doGenerate 函数
        const result = await doGenerateInner({
          ...params,
          temperature: params.temperature,
          modelId: this.modelId // 使用模型自身的 modelId
        });
        
        // 确保格式完全符合 ai 库的期望
        // 重新构建结果对象，确保包含所有必要的字段，特别是 usage
        return {
          response: {
            id: result.response.id,
            modelId: result.response.modelId,
            timestamp: result.response.timestamp,
            usage: {
              promptTokens: result.response.usage.promptTokens || 0,
              completionTokens: result.response.usage.completionTokens || 0,
              totalTokens: result.response.usage.totalTokens || 0
            }
          },
          object: result.object,
          intermediate_steps: result.intermediate_steps || []
        };
      } catch (error) {
        console.error("Error in model.doGenerate:", error);
        // 返回与 ai 库期望格式相同的对象
        return {
          response: {
            id: `gemini-error-${Date.now()}`,
            modelId: this.modelId, // 使用模型自身的 modelId
            timestamp: new Date().toISOString(),
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0
            }
          },
          object: {},
          intermediate_steps: []
        };
      }
    },
    
    // 流式生成
    async doStream() {
      throw new Error('Stream generation is not supported for Gemini models');
    }
  };
}

// 辅助函数：从数组中提取内容
function extractContentFromArray(contentArray: any[]): string {
  return contentArray
    .map((part: any) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if ('text' in part) return part.text;
        if ('content' in part) return part.content;
        // 尝试从对象中提取任何可能的文本内容
        return Object.values(part)
          .filter(v => typeof v === 'string')
          .join(' ');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// 辅助函数：创建成功响应对象
function createSuccessResponse(result: any, modelName: string) {
  if (!result || !result.object) {
    console.error('generateJsonWithGemini returned invalid result:', result);
    throw new Error('Failed to generate JSON object');
  }
  
  // 确保返回的对象符合 AI 库的期望格式
  return {
    response: {
      id: `gemini-gen-${Date.now()}`,
      modelId: modelName,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    },
    object: result.object,
    intermediate_steps: []
  };
}

/**
 * 实际执行结构化生成的方法
 */
async function doGenerateInner(params: {
  messages?: SimpleMessage[];
  prompt?: string | {role: string; content: string | any[]}[];
  system?: string;
  schema?: any;
  mode?: {type: string; schema?: any};
  temperature?: number;
  modelId: string;
}) {
  console.log('Generating object with schema using Gemini...');
  
  // 处理 mode.schema 参数（generateObject 调用时使用此格式）
  if (params.mode && params.mode.type === 'object-json' && params.mode.schema) {
    params.schema = params.mode.schema;
  }
  
  console.log('Schema:', params.schema);

  // 确定提示内容：优先使用prompt参数，其次从messages中提取
  let finalPrompt: string | undefined = undefined;
  let finalSystem = params.system;

  // 如果prompt是字符串，直接使用
  if (typeof params.prompt === 'string') {
    finalPrompt = params.prompt;
  }
  // 如果prompt是数组（generateObject调用时的格式），将其转换为messages
  else if (Array.isArray(params.prompt)) {
    params.messages = params.prompt as SimpleMessage[];
  }

  // 如果没有直接提供prompt，而是提供了messages数组
  if (!finalPrompt && params.messages) {
    try {
      if (!Array.isArray(params.messages)) {
        throw new Error(`无效的 messages 参数: 期望数组但收到 ${typeof params.messages}`);
      }

      console.log('messages 数组长度:', params.messages.length);
      if (params.messages.length > 0) {
        console.log('第一条消息类型:', typeof params.messages[0]);
        console.log('最后一条消息类型:', typeof params.messages[params.messages.length - 1]);
        
        // 记录角色分布
        const roles = params.messages.map((msg: any) => msg.role).join(', ');
        console.log('消息角色分布:', roles);
        
        // 提取system消息 (通常是第一条)
        const systemMsg = params.messages.find((msg: any) => msg.role === 'system');
        if (systemMsg) {
          finalSystem = extractMessageContent(systemMsg);
          console.log('提取的 system 内容长度:', finalSystem?.length || 0);
        }
        
        // 提取最后一条用户消息作为主要提示
        const userMsgs = params.messages.filter((msg: any) => msg.role === 'user');
        if (userMsgs.length > 0) {
          const lastUserMsg = userMsgs[userMsgs.length - 1];
          finalPrompt = extractMessageContent(lastUserMsg);
          console.log('提取的 prompt 内容长度:', finalPrompt?.length || 0);
          if (finalPrompt) {
            console.log('提取的 prompt 内容前100个字符:', finalPrompt.substring(0, 100) + '...');
          }
        }
      }
    } catch (error: any) {
      console.error('处理 messages 时出错:', error);
      throw new Error(`无效的 messages 参数: ${error.message}`);
    }
  }

  // 如果经过上述处理后仍然没有提示内容，则报错
  if (!finalPrompt) {
    throw new Error('无法从消息中提取有效的提示内容');
  }

  // 使用独立的函数来处理不同类型的消息
  function extractMessageContent(msg: any): string | undefined {
    if (!msg) return undefined;
    
    // 如果content是字符串，直接返回
    if (typeof msg.content === 'string') {
      return msg.content;
    }
    
    // 如果content是数组，从每个元素中提取text
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
        .map((part: any) => part.text);
      
      return textParts.join('\n');
    }
    
    // 如果content是对象，尝试获取text属性
    if (typeof msg.content === 'object' && msg.content !== null) {
      return msg.content.text || JSON.stringify(msg.content);
    }
    
    return undefined;
  }

  try {
    console.log('Generating object with schema using Gemini...');
    
    // 为了调试目的，记录schema的描述
    if (params.schema) {
      console.log('Schema description:', params.schema);
    }
    
    console.log('Final prompt type:', typeof finalPrompt);
    console.log('Final prompt (first 100 chars):', finalPrompt.substring(0, 100) + '...');
    
    // 生成JSON对象 
    const result = await generateJsonWithGemini({
      prompt: finalPrompt,
      system: finalSystem || '',
      schema: params.schema,
      temperature: params.temperature,
      modelId: params.modelId
    });
    
    console.log('generateJsonWithGemini 返回的结果类型:', typeof result);
    console.log('generateJsonWithGemini 返回的结果:', JSON.stringify(result, null, 2).substring(0, 200) + '...');
    
    // 估算token使用量
    const estimatedPromptTokens = Math.ceil((finalPrompt.length + (finalSystem?.length || 0)) / 4);
    const estimatedCompletionTokens = Math.ceil(JSON.stringify(result).length / 4);
    const estimatedTotalTokens = estimatedPromptTokens + estimatedCompletionTokens;
    
    // 确保返回的结构与 ai.generateObject 期望的完全一致
    return {
      response: {
        id: `gemini-gen-${Date.now()}`,
        modelId: params.modelId,
        timestamp: new Date().toISOString(),
        usage: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedTotalTokens
        }
      },
      object: result,
      intermediate_steps: []
    };
  } catch (error: any) {
    console.error('doGenerate error:', error);
    
    // 返回一个默认的空对象，同时保留正确的响应格式
    console.log('Returning default object based on schema due to error');
    
    // 即使在错误情况下，也确保返回完整的结构
    return {
      response: {
        id: `gemini-gen-${Date.now()}`,
        modelId: params.modelId,
        timestamp: new Date().toISOString(),
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      },
      object: {},
      intermediate_steps: []
    };
  }
} 