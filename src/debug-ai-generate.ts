import { generateObject } from 'ai';
import { z } from 'zod';
import { createGeminiModelForAI } from './ai/providers';

// 使用特殊符号以便查看详细日志输出
function logSection(title: string) {
  console.log('\n' + '='.repeat(20));
  console.log(title.toUpperCase());
  console.log('='.repeat(20));
}

// 打印对象详细结构的辅助函数
function inspectObject(obj: any, label = '', depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return '...';
  
  const indent = '  '.repeat(depth);
  const output: string[] = [];
  
  if (label) {
    output.push(`${indent}${label}:`);
  }
  
  if (obj === null) {
    output.push(`${indent}null`);
    return output.join('\n');
  }
  
  if (obj === undefined) {
    output.push(`${indent}undefined`);
    return output.join('\n');
  }
  
  if (typeof obj !== 'object') {
    output.push(`${indent}${typeof obj}: ${obj}`);
    return output.join('\n');
  }
  
  if (Array.isArray(obj)) {
    output.push(`${indent}Array(${obj.length}):`);
    obj.forEach((item, i) => {
      if (i < 5) { // 限制只显示前5个元素
        output.push(inspectObject(item, `[${i}]`, depth + 1, maxDepth));
      } else if (i === 5) {
        output.push(`${indent}  ... (${obj.length - 5} more items)`);
      }
    });
    return output.join('\n');
  }
  
  const keys = Object.keys(obj);
  output.push(`${indent}Object{${keys.length}}:`);
  
  keys.forEach(key => {
    try {
      output.push(inspectObject(obj[key], key, depth + 1, maxDepth));
    } catch (e) {
      output.push(`${indent}  ${key}: [Error inspecting property]`);
    }
  });
  
  return output.join('\n');
}

// 获取generateObject内部结构的模拟函数
function getInternalStructureInfo() {
  try {
    // 查看generateObject的内部结构
    const generateObjectStr = generateObject.toString();
    const relevantParts = 
      generateObjectStr.includes('NoObjectGeneratedError') 
        ? `${generateObjectStr.split('NoObjectGeneratedError')[0].slice(-500)}\n...\n${generateObjectStr.split('NoObjectGeneratedError')[1]?.slice(0, 500) || ''}`
        : "无法找到NoObjectGeneratedError相关代码";
    
    console.log("generateObject内部代码片段:", relevantParts);
  } catch (error) {
    console.error("无法检查generateObject内部结构:", error);
  }
}

// 1. 直接调用Gemini适配器的doGenerate方法
async function testAdapterDirectly() {
  logSection("测试1: 直接调用Gemini适配器");
  
  // 创建模型
  const geminiModel = createGeminiModelForAI('gemini-1.5-flash');
  console.log("模型对象属性:", Object.keys(geminiModel));
  
  const schema = z.object({
    questions: z.array(z.string()).describe("关于天空颜色的问题列表")
  });
  
  // 记录参数
  const params = {
    prompt: "生成3个关于天空为什么是蓝色的问题。以JSON格式返回。",
    schema: schema,
    temperature: 0.7,
    mode: 'json'
  };
  
  console.log("传递给doGenerate的参数:", params);
  
  try {
    // 直接调用doGenerate方法
    console.log("调用 model.doGenerate()...");
    const result = await geminiModel.doGenerate(params);
    
    console.log("doGenerate成功返回结果");
    console.log("返回值类型:", typeof result);
    console.log("返回值结构:", Object.keys(result));
    console.log("详细检查返回对象:");
    console.log(inspectObject(result));
    
    return result;
  } catch (error) {
    console.error("doGenerate调用失败:", error);
    return null;
  }
}

// 2. 记录ai.generateObject过程中的错误
async function testGenerateObject() {
  logSection("测试2: 调用ai.generateObject");
  
  const model = createGeminiModelForAI('gemini-1.5-flash');
  
  const schema = z.object({
    questions: z.array(z.string()).describe("关于天空颜色的问题列表")
  });
  
  try {
    console.log("调用 generateObject...");
    
    // 使用Proxy包装model来监控它的调用
    const monitoredModel = new Proxy(model, {
      get(target, prop, receiver) {
        const originalValue = Reflect.get(target, prop, receiver);
        
        // 如果是函数，我们包装它以便记录调用
        if (typeof originalValue === 'function' && 
            (prop === 'doGenerate' || prop === 'invoke')) {
          return async function(this: any, ...args: any[]) {
            console.log(`[监控] 调用model.${String(prop)}方法`);
            console.log(`[监控] 参数:`, args[0]);
            
            try {
              const result = await originalValue.apply(this, args);
              console.log(`[监控] ${String(prop)}返回结果:`, Object.keys(result || {}));
              console.log(`[监控] 详细返回:`, inspectObject(result));
              return result;
            } catch (e) {
              console.error(`[监控] ${String(prop)}方法抛出错误:`, e);
              throw e;
            }
          };
        }
        
        return originalValue;
      }
    });
    
    // 使用monitoredModel调用generateObject
    const result = await generateObject({
      model: monitoredModel,
      schema,
      prompt: '为主题"为什么天空是蓝色的"生成三个深入的问题',
      temperature: 0.7,
      mode: 'json',
    });
    
    console.log("generateObject调用成功!");
    console.log("结果:", result);
    
  } catch (error: unknown) {
    console.error("generateObject调用失败");
    
    if (error instanceof Error) {
      console.error("错误类型:", error.constructor.name);
      console.error("错误消息:", error.message);
      
      if (error.stack) {
        // 分析错误堆栈以找出确切的错误位置
        const stackLines = error.stack.split('\n');
        console.log("错误堆栈中的关键行:");
        
        stackLines.slice(0, 10).forEach((line: string) => {
          if (line.includes('/ai/') || line.includes('generate-object')) {
            console.log("  >", line.trim());
          }
        });
      }
      
      // 如果有中间步骤，显示它们
      const errorWithSteps = error as any;
      if (errorWithSteps.intermediate_steps) {
        console.log("中间步骤:", errorWithSteps.intermediate_steps);
      }
    } else {
      console.error("未知错误类型:", error);
    }
  }
}

// 3. 尝试分析ai.generateObject内部逻辑
async function analyzeAILibrary() {
  logSection("测试3: 分析AI库");
  
  // 尝试获取有关generateObject内部的信息
  getInternalStructureInfo();
}

// 主函数
async function main() {
  logSection("GEMINI AI.GENERATEOBJECT 诊断");
  console.log("开始进行详细诊断...");
  
  // 先测试直接调用适配器
  const adapterResult = await testAdapterDirectly();
  
  // 然后测试通过ai.generateObject调用
  await testGenerateObject();
  
  // 分析AI库
  await analyzeAILibrary();
  
  logSection("诊断完成");
}

// 添加一个全局的未捕获错误处理器，确保所有错误都被记录
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

main().catch((error) => {
  console.error('主程序出错:', error);
}); 