import { z } from 'zod';
import { generateObject } from 'ai';

import { createGeminiModel, SimpleMessage } from './ai/gemini-provider';
import { getModel, createGeminiModelForAI } from './ai/providers';
import { generateFeedback } from './feedback';

// 调试函数，用于递归打印对象结构
function debugObject(obj: any, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return '...';
  
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  
  if (typeof obj !== 'object') {
    return obj.toString();
  }
  
  const indent = '  '.repeat(depth);
  let result = '{\n';
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result += `${indent}  ${key}: `;
      
      try {
        const value = obj[key];
        if (value === null) {
          result += 'null';
        } else if (value === undefined) {
          result += 'undefined';
        } else if (typeof value === 'object') {
          result += debugObject(value, depth + 1, maxDepth);
        } else {
          result += String(value);
        }
      } catch (error) {
        result += `[Error: ${error}]`;
      }
      
      result += ',\n';
    }
  }
  
  result += `${indent}}`;
  return result;
}

// 测试直接调用doGenerate，检查返回值格式
async function testDirectDoGenerate() {
  console.log('测试 createGeminiModelForAI 和 doGenerate 方法');
  
  const model = createGeminiModelForAI('gemini-2.0-pro-exp-02-05');
  console.log('成功创建模型:', model.modelId);
  
  // 准备schema
  const schema = z.object({
    questions: z.array(z.string()).min(3)
  });
  
  console.log('Schema 定义:', schema);
  
  // 直接调用 doGenerate
  try {
    console.log('调用 doGenerate 方法...');
    
    const result = await model.doGenerate({
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      schema: schema,
      temperature: 0.7
    });
    
    console.log('doGenerate 返回结果:');
    console.log('- model:', result.model);
    console.log('- object:', result.object);
    console.log('- intermediate_steps:', result.intermediate_steps);
    console.log('- usage:', result.usage);
    console.log('  - prompt_tokens:', result.usage?.prompt_tokens);
    console.log('  - completion_tokens:', result.usage?.completion_tokens);
    console.log('  - total_tokens:', result.usage?.total_tokens);
    
    // 检查是否有必要的字段
    const hasRequiredFields = 
      result.usage && 
      'prompt_tokens' in result.usage && 
      'completion_tokens' in result.usage && 
      'total_tokens' in result.usage;
    
    console.log('是否包含所有必需的usage字段:', hasRequiredFields);
    
    return result;
  } catch (error) {
    console.error('调用 doGenerate 出错:', error);
    return null;
  }
}

// 测试调用AI库的generateObject，用于验证与AI库的兼容性
async function testGenerateObject() {
  console.log('\n测试 ai.generateObject 方法');
  
  try {
    // 创建使用标准参数的模型
    const model = createGeminiModelForAI('gemini-2.0-pro-exp-02-05');
    
    // 准备schema
    const schema = z.object({
      questions: z.array(z.string()).min(3)
    });
    
    console.log('调用 ai.generateObject...');
    
    // 只传递 AI 库支持的参数
    const result = await generateObject({
      model,
      schema,
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      temperature: 0.7,
      mode: 'json', // 使用AI库支持的值
    });
    
    console.log('generateObject 返回结果:');
    console.log('- object:', result.object);
    console.log('- usage:', result.usage);
  } catch (error: unknown) {
    console.error('调用 generateObject 出错:', error);
    if (error instanceof Error) {
      console.error('错误类型:', error.constructor.name);
      console.error('错误信息:', error.message);
      console.error('错误堆栈:', error.stack);
    }
  }
}

// 测试 doGenerate 方法
async function testDoGenerate() {
  console.log('开始测试 doGenerate 方法');
  
  const model = createGeminiModel('gemini-2.0-pro-exp-02-05');
  console.log('成功创建 Gemini 模型');
  
  // 测试使用 schema 的生成
  const schema = z.object({
    questions: z.array(z.string()).min(3)
  });
  
  console.log('Schema 定义:', schema);
  
  // 测试不同的输入格式
  
  // 情形1：使用prompt参数
  try {
    console.log('测试情形1：使用 prompt 参数');
    
    const result = await model.doGenerate({
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      schema: schema,
      temperature: 0.7
    });
    
    console.log('生成结果:', result);
    const questions = result.object?.questions || [];
    if (questions.length > 0) {
      console.log('成功生成问题:', questions);
    } else {
      console.log('未能生成有效问题。结果:', result.object);
    }
  } catch (error) {
    console.error('测试情形1失败:', error);
  }
  
  // 情形2：使用更复杂的消息格式
  try {
    console.log('\n测试情形2：使用消息数组');
    
    const messages: SimpleMessage[] = [
      { role: 'user', content: '为主题"为什么天空是蓝色的"生成三个深入的问题' }
    ];
    
    const result = await model.doGenerate({
      messages,
      schema: schema,
      temperature: 0.7
    });
    
    console.log('生成结果:', result);
    const questions = result.object?.questions || [];
    if (questions.length > 0) {
      console.log('成功生成问题:', questions);
    } else {
      console.log('未能生成有效问题。结果:', result.object);
    }
  } catch (error) {
    console.error('测试情形2失败:', error);
  }
  
  // 情形3：直接传递prompt和system
  try {
    console.log('\n测试情形3：直接传递 prompt 和 system');
    
    const result = await model.doGenerate({
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      system: '你是一位专业教育工作者，负责生成深入而有启发性的问题',
      schema: schema,
      temperature: 0.7
    });
    
    console.log('生成结果:', result);
    const questions = result.object?.questions || [];
    if (questions.length > 0) {
      console.log('成功生成问题:', questions);
    } else {
      console.log('未能生成有效问题。结果:', result.object);
    }
  } catch (error) {
    console.error('测试情形3失败:', error);
  }
  
  // 使用 ai.generateObject
  try {
    console.log('\n测试 ai.generateObject');
    
    const result = await generateObject({
      model: getModel(),
      schema: schema,
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      temperature: 0.7,
    });
    
    console.log('生成结果:', result);
    const questions = result.object?.questions || [];
    if (questions.length > 0) {
      console.log('成功生成问题:', questions);
    } else {
      console.log('未能生成有效问题。结果:', result.object);
    }
  } catch (error) {
    console.error('测试 ai.generateObject 失败:', error);
  }
}

// 测试生成反馈问题
async function testGenerateFeedback() {
  console.log('\n开始测试 generateFeedback 方法');
  
  try {
    const feedback = await generateFeedback({
      query: '为什么天空是蓝色的',
      numQuestions: 3
    });
    console.log('生成的反馈问题:', feedback);
  } catch (error) {
    console.error('测试 generateFeedback 失败:', error);
  }
}

// 运行测试
async function runTests() {
  // 测试用于ai.generateObject的兼容性
  await testGenerateObject();
  
  // 测试原始的doGenerate
  await testDoGenerate();
  
  // 测试反馈生成
  await testGenerateFeedback();
}

runTests().catch(console.error); 