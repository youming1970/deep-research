import { generateObject } from 'ai';
import { z } from 'zod';

import { getModel } from './ai/providers';
import { systemPrompt } from './prompt';
import { generateJsonWithGemini } from './ai/gemini-helper';

// 定义默认回退问题
const DEFAULT_QUESTIONS = [
  'Could you provide more details about your specific interests in this topic?',
  'What aspects of this topic are most important to you?',
  'Are there any specific questions you want answered about this topic?'
];

// 直接实现 generateFeedback 功能，不使用 generateObject
async function generateFeedbackDirect(query: string, numQuestions: number): Promise<string[]> {
  console.log('使用直接方法生成反馈问题');
  
  try {
    // 使用简化的JSON schema定义，这样更容易被Gemini理解
    const jsonSchema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "string"
          },
          description: `Follow up questions to clarify the research direction, max of ${numQuestions}`
        },
        followUpQuestions: {
          type: "array",
          items: {
            type: "string"
          },
          description: `Alternative name for follow up questions, max of ${numQuestions}`
        }
      },
      required: ["questions"]
    };
    
    const result = await generateJsonWithGemini({
      prompt: `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
      system: systemPrompt(),
      schema: jsonSchema,
      temperature: 0.5
    });
    
    // 详细记录返回的对象结构
    console.log('Gemini 返回的原始对象:', JSON.stringify(result, null, 2));
    
    // 尝试找到可能存在的问题数组
    let questions: string[] = [];
    
    if (result) {
      // 检查不同的可能字段名
      if (Array.isArray(result.questions)) {
        console.log('找到字段 "questions" 包含字符串数组');
        questions = result.questions;
      } else if (Array.isArray(result.follow_up_questions)) {
        console.log('找到字段 "follow_up_questions" 包含字符串数组');
        questions = result.follow_up_questions;
      } else if (Array.isArray(result.followUpQuestions)) {
        console.log('找到字段 "followUpQuestions" 包含字符串数组');
        questions = result.followUpQuestions;
      } else {
        // 尝试找到任何包含字符串数组的字段
        for (const key in result) {
          if (Array.isArray(result[key]) && 
              result[key].length > 0 && 
              typeof result[key][0] === 'string') {
            console.log(`找到替代字段 "${key}" 包含字符串数组`);
            questions = result[key];
            break;
          }
        }
      }
    }
    
    if (questions.length === 0) {
      console.warn('无法从响应中提取有效的问题数组，使用默认问题');
      return DEFAULT_QUESTIONS.slice(0, numQuestions);
    }
    
    console.log('直接方法成功生成反馈问题:', questions);
    return questions.slice(0, numQuestions);
  } catch (error) {
    console.error('生成反馈时出错:', error);
    return DEFAULT_QUESTIONS.slice(0, numQuestions);
  }
}

// 旧的 Gemini 特定实现，保留作为参考
async function generateFeedbackWithGemini(query: string, numQuestions: number): Promise<string[]> {
  console.log('使用 Gemini 直接生成反馈问题');
  
  try {
    const schema = z.object({
      questions: z
        .array(z.string())
        .describe(
          `Follow up questions to clarify the research direction, max of ${numQuestions}`,
        ),
    });
    
    const result = await generateJsonWithGemini({
      prompt: `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
      system: systemPrompt(),
      schema,
      temperature: 0.5
    });
    
    if (result.object && Array.isArray(result.object.questions)) {
      console.log('Gemini 成功生成反馈问题');
      return result.object.questions.slice(0, numQuestions);
    } else {
      console.warn('Gemini 返回的对象格式不正确', result.object);
      // 如果格式不正确，返回默认问题而不是抛出错误
      return DEFAULT_QUESTIONS.slice(0, numQuestions);
    }
  } catch (error) {
    console.error('Gemini 生成反馈时出错:', error);
    // 出错时返回默认问题而不是重新抛出错误
    return DEFAULT_QUESTIONS.slice(0, numQuestions);
  }
}

// 主函数，现在完全绕过 generateObject
export async function generateFeedback({
  query,
  numQuestions = 3,
}: {
  query: string;
  numQuestions?: number;
}) {
  try {
    // 直接使用我们自己的实现，不再依赖 generateObject
    return await generateFeedbackDirect(query, numQuestions);
  } catch (error) {
    console.error('生成反馈时出错:', error);
    // 出错时返回默认问题
    return DEFAULT_QUESTIONS.slice(0, numQuestions);
  }
}
