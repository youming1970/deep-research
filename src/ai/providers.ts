import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  LanguageModelV1,
  wrapLanguageModel,
} from 'ai';
import { getEncoding } from 'js-tiktoken';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { RecursiveCharacterTextSplitter } from './text-splitter';
import { createGeminiModel, type SimpleMessage } from './gemini-provider';

// 定义AIModel类型 - 用于我们的模型适配器
type AIModel = any; // 简化处理，用any代替完整的接口定义

// Providers - 创建OpenAI兼容客户端
const openaiClient = (process.env.OPENAI_KEY)
  ? createOpenAI({
      apiKey: process.env.OPENAI_KEY,
      baseURL: 'https://api.openai.com/v1',
    })
  : undefined;

const fireworks = process.env.FIREWORKS_KEY
  ? createFireworks({
      apiKey: process.env.FIREWORKS_KEY,
    })
  : undefined;

// 如果有Google API密钥，则创建一个Gemini模型
const geminiModel = process.env.GOOGLE_API_KEY && process.env.CUSTOM_MODEL
  ? createGeminiModel(process.env.CUSTOM_MODEL)
  : undefined;

// 使用 customModel 或创建一个默认模型
const customModel = openaiClient && process.env.CUSTOM_MODEL && !process.env.GOOGLE_API_KEY
  ? openaiClient(process.env.CUSTOM_MODEL, {
      structuredOutputs: true,
    })
  : undefined;

// Models
const o3MiniModel = openaiClient?.('o3-mini', {
  reasoningEffort: 'medium',
  structuredOutputs: true,
});

const deepSeekR1Model = fireworks
  ? wrapLanguageModel({
      model: fireworks(
        'accounts/fireworks/models/deepseek-r1',
      ) as LanguageModelV1,
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  : undefined;

// 用于正确处理token的估算
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 为与 ai.generateObject 兼容的适配器
 * 包装了 Gemini 模型，确保返回的数据格式符合 ai 库的预期
 */
export function createGeminiModelForAI(modelId: string): AIModel {
  // 创建基础的 Gemini 模型
  const baseModel = createGeminiModel(modelId);
  
  // 包装为符合 AIModel 接口的对象
  return {
    modelId: baseModel.modelId,
    provider: baseModel.provider,
    specificationVersion: baseModel.specificationVersion,
    structuredOutputs: true, // 确保启用结构化输出
    defaultObjectGenerationMode: 'json', // 使用AI库支持的值
    
    // 基本文本生成
    async invoke(params: { messages: any[]; temperature?: number }): Promise<any> {
      // 调用基础模型的 invoke 方法
      const result = await baseModel.invoke(params);
      
      // 确保返回值符合 ai 库的预期
      return {
        ...result,
        usage: {
          prompt_tokens: result.response.usage.promptTokens || 0,
          completion_tokens: result.response.usage.completionTokens || 0,
          total_tokens: result.response.usage.total_tokens || 0
        }
      };
    },
    
    // 生成结构化输出
    async doGenerate(params: any): Promise<any> {
      try {
        console.log('AI Adapter: 调用基础模型的 doGenerate 方法');
        
        // 调用基础模型的 doGenerate 方法
        const result = await baseModel.doGenerate(params);
        console.log('AI Adapter: 基础模型返回结果', JSON.stringify({
          responseId: result.response?.id,
          objectKeys: result.object ? Object.keys(result.object) : [],
          usageInfo: result.response?.usage || {}
        }, null, 2));
        
        // 估算token数量，确保结果格式符合 ai 库预期
        const promptTokens = result.response?.usage?.promptTokens || 0;
        const completionTokens = result.response?.usage?.completionTokens || 0;
        const totalTokens = result.response?.usage?.total_tokens || 0;
        
        // 创建当前时间对象(而不是字符串)，使其能被toISOString调用
        const currentTimestamp = new Date();
        
        // ======重要======
        // 按照ai库的generateObject期望格式构建返回值
        // 查看文档和代码，发现需要返回这样的结构:
        // 1. 一个对象，其中包含model, object, usage等
        // 2. usage对象必须包含特定命名的token计数
        // 3. 数据格式要完全匹配
        
        // 返回值需与ai.generateObject预期匹配
        const formattedResult = {
          object: result.object || {},
          finishReason: "stop",
          model: baseModel.modelId,
          id: result.response?.id || `gemini-gen-${Date.now()}`,
          prompt: params.prompt || '',
          promptTemplate: params.promptTemplate,
          // 提供原始Date对象，而不是字符串
          timestamp: result.response?.timestamp ? new Date(result.response.timestamp) : currentTimestamp,
          // 添加text字段，ai库内部检查这个字段是否存在
          text: JSON.stringify(result.object || {}),
          usage: {
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            totalTokens: totalTokens,
            // 添加OpenAI兼容字段
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens
          },
          // 完成ai.generateObject要求的必要字段
          response: {
            id: result.response?.id || `gemini-gen-${Date.now()}`,
            modelId: baseModel.modelId,
            // 在response中也使用Date对象
            timestamp: result.response?.timestamp ? new Date(result.response.timestamp) : currentTimestamp,
            usage: {
              inputTokens: promptTokens,
              outputTokens: completionTokens,
              totalTokens: totalTokens
            }
          },
          intermediate_steps: result.intermediate_steps || []
        };
        
        console.log('AI Adapter: 返回格式化结果', {
          objectKeys: Object.keys(formattedResult),
          usageKeys: Object.keys(formattedResult.usage)
        });
        
        return formattedResult;
      } catch (error) {
        console.error('Error in doGenerate adapter:', error);
        // 创建当前时间对象(而不是字符串)
        const errorTimestamp = new Date();

        return {
          object: {},
          finishReason: "error",
          model: baseModel.modelId,
          id: `gemini-error-${Date.now()}`,
          prompt: params.prompt || '',
          // 使用Date对象而不是字符串
          timestamp: errorTimestamp,
          // 添加text字段，确保错误情况下也有这个字段
          text: "{}",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            // 添加OpenAI兼容字段
            prompt_tokens: 0, 
            completion_tokens: 0,
            total_tokens: 0
          },
          // 完成ai.generateObject要求的必要字段
          response: {
            id: `gemini-error-${Date.now()}`,
            modelId: baseModel.modelId,
            // 在response中也使用Date对象
            timestamp: errorTimestamp,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0
            }
          },
          intermediate_steps: []
        };
      }
    },
    
    // 流式生成
    async doStream(): Promise<any> {
      throw new Error('Stream generation is not supported for Gemini models');
    }
  };
}

// 修改 getModel 函数，使用新的适配器
export function getModel() {
  const modelId = process.env.DEFAULT_MODEL || 'gemini-1.5-flash';

  // ===== 诊断日志 =====
  console.log('----- getModel 函数诊断 -----');
  console.log('环境变量 DEFAULT_MODEL:', process.env.DEFAULT_MODEL); // 打印环境变量的值
  console.log('最终确定的模型 ID:', modelId); // 打印最终使用的模型 ID
  console.log('----- 诊断日志结束 -----');

  return createGeminiModelForAI(modelId);
}

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}
