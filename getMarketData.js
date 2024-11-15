const fs = require('fs').promises;
const path = require('path');
// 动态导入 node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// 需要获取的物品id
const ids = [
  3, 4, 5, 7, 8, 9, 11, 12, 24, 25, 26, 27, 28, 53, 54, 55, 56, 57, 
  60, 61, 62, 63, 64, 65, 67, 70, 71, 98, 102, 103, 108, 109, 110,
  119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 140, 144,146, 147, 148
];

// 添加延迟函数
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 获取市场API数据
async function fetchMarketData(itemID, realm) {
  const url = `https://www.simcompanies.com/api/v3/market/all/${realm}/${itemID}/`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        console.log(`第 ${attempt} 次尝试失败，状态码 429，2 秒后重试...`);
        await sleep(2000);
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP 错误！状态码：${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (attempt === 5) {
        console.error(`无法获取 itemID ${itemID} 的数据，在 5 次尝试后失败。`);
        return null;  // 如果在 5 次重试后失败，返回 null
      }
    }
  }
}

// 并发限制批量请求并确保获取全部数据
async function fetchWithLimit(ids, realm_id, limit = 3) {
  const minPriceDict = {};
  let batchCount = 0;
  let failedRequests = [];

  for (let i = 0; i < ids.length; i += limit) {
    const batch = ids.slice(i, i + limit); // 每次处理 limit 个请求
    batchCount++;

    // 发送批量请求
    const results = await Promise.allSettled(batch.map(itemID => fetchMarketData(itemID, realm_id)));

    // 处理返回的数据，记录失败的请求
    results.forEach((result, index) => {
      const itemID = batch[index];
      if (result.status === 'fulfilled' && result.value) {
        result.value.forEach(item => {
          const key = `${item.kind},${item.quality}`;
          if (!minPriceDict[key] || item.price < minPriceDict[key].price) {
            minPriceDict[key] = {
              kind: item.kind,
              quality: item.quality,
              price: item.price,
            };
          }
        });
      } else {
        console.error(`第 ${batchCount} 批次，itemID ${itemID} 失败，加入重试列表。`);
        failedRequests.push(itemID);
      }
    });

    // 每批处理完后延迟一段时间再处理下一批
    if (i + limit < ids.length) {
      console.log(`第 ${batchCount} 批次处理完成，等待 2 秒后继续处理下一批...`);
      await sleep(2000); // 延迟 2 秒
    }
  }

  // 处理失败的请求，直到所有请求成功
  while (failedRequests.length > 0) {
    console.log(`正在重试失败的请求，共有 ${failedRequests.length} 个请求待重试...`);
    const failedBatch = [...failedRequests]; // 复制失败的请求列表
    failedRequests = [];

    const retryResults = await Promise.allSettled(failedBatch.map(itemID => fetchMarketData(itemID, realm_id)));

    retryResults.forEach((result, index) => {
      const itemID = failedBatch[index];
      if (result.status === 'fulfilled' && result.value) {
        result.value.forEach(item => {
          const key = `${item.kind},${item.quality}`;
          if (!minPriceDict[key] || item.price < minPriceDict[key].price) {
            minPriceDict[key] = {
              kind: item.kind,
              quality: item.quality,
              price: item.price,
            };
          }
        });
      } else {
        console.error(`请求失败，itemID ${itemID} 仍然失败，将再次重试。`);
        failedRequests.push(itemID); // 失败的请求重新添加到列表中
      }
    });

    if (failedRequests.length > 0) {
      console.log(`等待 2 秒后重试失败的请求...`);
      await sleep(2000); // 延迟 2 秒
    }
  }

  return minPriceDict;
}

// 处理传入的ID列表并查询API
async function getPriceData(realm_id, batchLimit = 5) {
  const minPriceDict = await fetchWithLimit(ids, realm_id, batchLimit);

  return Object.values(minPriceDict).map(({ kind, quality, price }) => [kind, quality, price]);
}

// 主函数，获取数据并保存到文件
async function main() {
  const args = process.argv.slice(2);
  const REALM_ID = args[0]; // 从命令行参数获取 REALM_ID
  if (!REALM_ID) {
    console.error("请提供 REALM_ID 作为命令行参数。");
    process.exit(1);
  }

  const fileNames = { '0': '0_market_data.json', '1': '1_market_data.json' };
  const FILE_PATH = path.join(__dirname, fileNames[REALM_ID] || 'market_data.json');

  try {
    const data = await getPriceData(REALM_ID, 5); // 控制并发数为 5
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
    console.log("数据获取并成功保存。");
  } catch (error) {
    console.error("获取或保存数据时出错：", error);
  }
}

main();