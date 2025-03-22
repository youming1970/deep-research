import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testGeminiBasic() {
  try {
    console.log("Testing basic Gemini API call...");
    console.log("API Key: ", process.env.GOOGLE_API_KEY?.substring(0, 10) + "...");
    
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
    
    // 测试基本文本生成
    const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    console.log("Generating content...");
    const result = await geminiModel.generateContent("Tell me a short joke about programming");
    const response = await result.response;
    const text = response.text();
    
    console.log("Response:", text);
    
    console.log("\nBasic test completed successfully");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// 运行测试
testGeminiBasic().catch(console.error); 