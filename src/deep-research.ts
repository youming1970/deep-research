import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';

function log(...args: any[]) {
  console.log(...args);
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// 自定义搜索结果类型，与Firecrawl兼容
interface SearchResult {
  links: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawlKey = process.env.FIRECRAWL_KEY || '';
const firecrawl = new FirecrawlApp({
  apiKey: firecrawlKey,
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// 当Firecrawl搜索失败时，提供模拟搜索结果
async function mockSearchResults(query: string): Promise<SearchResult> {
  console.warn(`Using mock search results for query: ${query} (FIRECRAWL_KEY may be invalid)`);
  return {
    links: [
      {
        title: "Wikipedia - " + query,
        url: "https://en.wikipedia.org/wiki/" + query.replace(/\s+/g, '_'),
        snippet: "This is a placeholder result. Please configure a valid FIRECRAWL_KEY to get real search results."
      },
      {
        title: "Google Search - " + query,
        url: "https://www.google.com/search?q=" + encodeURIComponent(query),
        snippet: "For actual results, please search on Google or configure a valid Firecrawl API key."
      }
    ]
  };
}

// 执行搜索，如果失败则使用模拟结果
async function safeSearch(query: string): Promise<SearchResult> {
  try {
    // 尝试使用Firecrawl进行搜索
    const response = await firecrawl.search(query);
    return response as unknown as SearchResult;
  } catch (error) {
    console.error(`Firecrawl search failed for query "${query}":`, error);
    // 使用模拟结果作为后备方案
    return mockSearchResults(query);
  }
}

// take en user query, return a list of SERP queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;

  // optional, if provided, the research will continue from the last learning
  learnings?: string[];
}) {
  try {
    // 构建提示
    let promptText = `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>`;
    
    // 如果有之前的研究结果，添加到提示中
    if (learnings && learnings.length > 0) {
      promptText += `\n\nHere are some learnings from previous research, use them to generate more specific queries: ${learnings.join('\n')}`;
    }
    
    // 记录提示
    console.log('generateSerpQueries prompt type:', typeof promptText);
    console.log('generateSerpQueries prompt (first 100 chars):', promptText.substring(0, 100) + '...');
    
    try {
      const res = await generateObject({
        model: getModel(),
        system: systemPrompt(),
        prompt: promptText,
        schema: z
          .object({
            queries: z
              .array(
                z.object({
                  query: z.string().describe('The SERP query'),
                  researchGoal: z
                    .string()
                    .describe(
                      'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
                    ),
                }),
              )
              .describe(`List of SERP queries, max of ${numQueries}`),
          })
          .describe('List of SERP queries'),
      });
      
      log(`Created ${res.object.queries.length} queries`, res.object.queries);
      return res.object.queries.slice(0, numQueries);
    } catch (e) {
      console.error('Error in generateObject for SERP queries:', e);
      // 如果生成失败，创建一些默认查询
      return [
        {
          query: query,
          researchGoal: 'Explore the main concepts and information about this topic',
        }
      ];
    }
  } catch (error) {
    console.error('Error generating SERP queries:', error);
    // 如果整个函数失败，返回一个非常基本的查询
    return [
      {
        query: query,
        researchGoal: 'Explore the main concepts and information about this topic',
      }
    ];
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResult;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = compact(result.links.map(item => item.snippet)).map(
    content => trimPrompt(content, 25_000),
  );
  log(`Ran ${query}, found ${contents.length} contents`);

  // 构建提示
  const contentTexts = contents
    .map(content => `<content>\n${content}\n</content>`)
    .join('\n');
  
  const promptText = trimPrompt(
    `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contentTexts}</contents>`
  );
  
  // 记录提示
  console.log('processSerpResult prompt type:', typeof promptText);
  console.log('processSerpResult prompt (first 100 chars):', promptText.substring(0, 100) + '...');

  try {
    const res = await generateObject({
      model: getModel(),
      abortSignal: AbortSignal.timeout(60_000),
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        learnings: z
          .array(z.string())
          .describe(`List of learnings, max of ${numLearnings}`),
        followUpQuestions: z
          .array(z.string())
          .describe(
            `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
          ),
      }),
    });
    log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);

    return res.object;
  } catch (error) {
    console.error('Error processing SERP result:', error);
    // 返回空数组，上层函数可以决定如何处理
    return {
      learnings: [],
      followUpQuestions: []
    };
  }
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  // 构建学习字符串
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  // 构建提示
  const promptText = trimPrompt(
    `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`
  );
  
  // 记录提示
  console.log('writeFinalReport prompt type:', typeof promptText);
  console.log('writeFinalReport prompt (first 100 chars):', promptText.substring(0, 100) + '...');

  try {
    const res = await generateObject({
      model: getModel(),
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        reportMarkdown: z
          .string()
          .describe('Final report on the topic in Markdown'),
      }),
    });

    // Append the visited URLs section to the report
    const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
    return res.object.reportMarkdown + urlsSection;
  } catch (error) {
    console.error('Error writing final report:', error);
    // 返回简单的错误报告
    return `# Research Report on: ${prompt}\n\n## Error\n\nUnable to generate a complete report due to an error. Here are the key learnings:\n\n${learnings.map(l => `- ${l}`).join('\n')}\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  }
}

export async function writeFinalAnswer({
  prompt,
  learnings,
}: {
  prompt: string;
  learnings: string[];
}) {
  // 构建学习字符串
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  // 构建提示
  const promptText = trimPrompt(
    `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from research on the topic that you can use to help answer the prompt:\n\n<learnings>\n${learningsString}\n</learnings>`
  );
  
  // 记录提示
  console.log('writeFinalAnswer prompt type:', typeof promptText);
  console.log('writeFinalAnswer prompt (first 100 chars):', promptText.substring(0, 100) + '...');

  try {
    const res = await generateObject({
      model: getModel(),
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        exactAnswer: z
          .string()
          .describe(
            'The final answer, make it short and concise, just the answer, no other text',
          ),
      }),
    });

    return res.object.exactAnswer;
  } catch (error) {
    console.error('Error generating final answer:', error);
    // 如果生成失败，返回一个基于所有学习结果的简单总结
    return "Based on the research, I couldn't generate a precise answer in the requested format, but here's a summary of the key findings: " + 
           learnings.slice(0, 3).join(" ");
  }
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<ResearchResult> {
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const result = await safeSearch(serpQuery.query);

          // Collect URLs from this search
          const newUrls = compact(result.links.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
          });
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              onProgress,
            });
          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}

// extract learnings from a search result
async function processSearchResults({
  searchResults,
  query,
  researchGoal,
}: {
  searchResults: any[]; // 使用正确的类型
  query: string;
  researchGoal: string;
}) {
  // Combine the search results into a single string for processing
  const combinedResults = searchResults
    .map(
      (result, idx) =>
        `[${idx + 1}] ${result.title}\nURL: ${result.url}\n${
          result.snippet
        }\n\n`,
    )
    .join('');

  try {
    const res = await generateObject({
      model: getModel(),
      system: systemPrompt(),
      prompt: trimPrompt(
        `You are processing search results for the query: ${query}\n\nThe research goal is: ${researchGoal}\n\nHere are the search results:\n\n${combinedResults}\n\nGiven the search results above, your task is to extract learnings (factual information) that are relevant to the research goal. You should also suggest new research directions to explore more about the topic. Search for evidence in the text, and don't make things up if you don't see information on the topic.\n\nOnly include information that is directly supported by the search results. Cite the source number ([1], [2], etc.) after every fact you extract, and if possible include the URL.  Always put the source at the end of the sentence.`,
      ),
      schema: z.object({
        learnings: z
          .array(z.string().describe('Individual learning/fact extracted'))
          .describe('List of learnings'),
        newDirections: z
          .array(
            z.string().describe('Specific new research direction to explore'),
          )
          .describe('List of new research directions'),
      }),
    });

    return {
      learnings: res.object.learnings,
      newDirections: res.object.newDirections,
    };
  } catch (error) {
    console.error('Error processing search results:', error);
    // 如果处理失败，返回一个简单的回退值
    return {
      learnings: [`Found relevant information about ${query} but couldn't extract specific learnings`],
      newDirections: [`Continue researching about ${query}`],
    };
  }
}
