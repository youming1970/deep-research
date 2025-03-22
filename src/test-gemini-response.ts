import { generateJsonWithGemini } from './ai/gemini-helper';
import { z } from 'zod';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.local' });

// 测试schema
const TestSchema = z.object({
  message: z.string(),
  items: z.array(z.string()),
});

/**
 * 测试Gemini API的JSON响应特点
 */
async function testGeminiJsonResponse() {
  console.log('======= 测试 Gemini API JSON 响应特点 =======');
  
  const modelId = process.env.DEFAULT_MODEL || 'gemini-2.0-pro-exp-02-05';
  console.log(`使用模型: ${modelId}`);
  
  // 简单prompt测试，创建基本JSON
  const simplePrompt = '生成一个包含message和items字段的JSON对象，message是问候语，items是一个包含3个水果名称的字符串数组';
  
  try {
    console.log('测试1: 简单JSON生成');
    const result1 = await generateJsonWithGemini({
      prompt: simplePrompt,
      system: '你是一个JSON生成助手',
      modelId,
      schema: TestSchema
    });
    
    console.log('测试1结果:', JSON.stringify(result1, null, 2));
  } catch (error) {
    console.error('测试1失败:', error);
  }
  
  // 测试生成较复杂的JSON，可能包含特殊字符
  const complexPrompt = '生成一个包含message和items字段的JSON对象，message是一段包含换行符、引号和特殊字符的文本，items是一个包含5个包含特殊字符的项目';
  
  try {
    console.log('\n测试2: 包含特殊字符的JSON生成');
    const result2 = await generateJsonWithGemini({
      prompt: complexPrompt,
      system: '你是一个JSON生成助手',
      modelId,
      schema: TestSchema
    });
    
    console.log('测试2结果:', JSON.stringify(result2, null, 2));
  } catch (error) {
    console.error('测试2失败:', error);
  }
  
  // 测试生成较长的、可能触发控制字符问题的JSON
  const longPrompt = '生成一个包含message和items字段的JSON对象，message是一段较长的（至少300字）关于数据处理的技术文档，items是一个包含10个复杂项目的数组，每个项目都是包含特殊字符和格式的字符串';
  
  try {
    console.log('\n测试3: 生成长文本JSON测试');
    const result3 = await generateJsonWithGemini({
      prompt: longPrompt,
      system: '你是一个JSON生成助手',
      modelId,
      schema: TestSchema
    });
    
    console.log('测试3结果:', JSON.stringify(result3, null, 2).substring(0, 200) + '...');
  } catch (error) {
    console.error('测试3失败:', error);
  }
}

// 执行测试
testGeminiJsonResponse().catch(console.error); 