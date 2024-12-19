const fs = require('fs').promises;
const path = require('path');
// 动态导入 node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// 需要获取的物品ID
const ids = [
  3, 4, 5, 7, 8, 9, 11, 12, 24, 25, 26, 27, 28, 53, 54, 55, 56, 57, 
  60, 61, 62, 63, 64, 65, 67, 70, 71, 98, 102, 103, 108, 109, 110,
  119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 140, 144, 146, 147, 148, 150
];

// 获取市场前一天vwap价格
async function fetchAllMarketData(realm) {
  const url = `https://api.simcotools.com/v1/realms/${realm}/market/vwaps`;
  
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP 错误！状态码：${response.status}`);
    }

    const data = await response.json();
    console.log(`成功获取领域 ${realm} 的数据，共 ${data.vwaps.length} 条记录。`);
    return data.vwaps;
  } catch (error) {
    console.error(`请求错误：领域 ${realm}，错误信息：${error.message}`);
    return null;
  }
}

// 将原始数据按指定 IDs 过滤并转换为目标格式
function filterAndTransformData(vwaps) {
  const result = [];
  vwaps.forEach(({ resourceId, quality, vwap }) => {
    if (ids.includes(resourceId)) {
      result.push([resourceId, quality, vwap]);
    }
  });
  return result;
}

// 主函数，获取数据并保存到文件
async function main() {
  const realms = [0, 1]; // 领域列表
  const fileNames = { 0: '0_market_data.json', 1: '1_market_data.json' };

  for (const realm of realms) {
    const FILE_PATH = path.join(__dirname, fileNames[realm]);

    try {
      console.log(`正在获取领域 ${realm} 的数据...`);
      const data = await fetchAllMarketData(realm);

      if (data) {
        const filteredData = filterAndTransformData(data); // 按指定 ID 过滤并转换为目标格式
        await fs.writeFile(FILE_PATH, JSON.stringify(filteredData, null, 2));
        console.log(`领域 ${realm} 的数据已成功保存到文件：${FILE_PATH}`);
      } else {
        console.error(`领域 ${realm} 的数据获取失败，未保存到文件。`);
      }
    } catch (error) {
      console.error(`处理领域 ${realm} 时出错：`, error);
    }
  }
}

main();
