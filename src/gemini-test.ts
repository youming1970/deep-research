import { createGeminiModelForAI } from './ai/providers';
import { generateObject } from 'ai';
import { z } from 'zod';

async function testGeminiStandalone() {
    console.log("开始 Gemini 独立测试...");

    const model = createGeminiModelForAI({ apiKey: process.env.GEMINI_API_KEY });

    const schema = z.object({
        questions: z.array(z.string()).describe("关于天空颜色的问题列表")
    });

    const prompt = "请生成 3 个关于天空为什么是蓝色的问题。";

    try {
        const result = await generateObject({
            model,
            prompt,
            schema,
        });

        console.log("\ngenerateObject 结果:");
        console.log("-----------------------");
        console.log("完整结果对象:", result);
        console.log("\n解析后的 object:", result.object);
        console.log("\nResponse 对象:", result.response);
        console.log("\nUsage 对象:", result.response.usage);
        console.log("-----------------------");


    } catch (error: any) {
        console.error("\ngenerateObject 发生错误:");
        console.error("-----------------------");
        console.error("错误详情:", error);
        if (error.intermediate_steps) {
            console.error("\n中间步骤:", error.intermediate_steps);
        }
        console.error("-----------------------");
    }

    console.log("Gemini 独立测试结束.");
}

testGeminiStandalone();
