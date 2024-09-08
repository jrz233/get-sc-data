const axios = require('axios');
const fs = require('fs');

// 分类存放不同建筑工资
const categorizedBuildingWages = {
    // 电子产品商店跟五金
    "172.5": [102, 103, 108, 109, 110, 24, 25, 26, 27, 28, 98],
    // 加油站
    "345": [11, 12],
    // 时装商店
    "310.5": [60, 61, 62, 63, 64, 65, 70, 71],
    // 生鲜商店
    "138": [3, 4, 5, 7, 8, 9, 67, 119, 122, 123, 124, 125, 126, 127, 140, 144],
    // 车行
    "379.5": [53, 54, 55, 56, 57],
};

// 生成建筑工资数据表
const buildingWagesData = Object.entries(categorizedBuildingWages).reduce((acc, [wage, ids]) => {
    ids.forEach(id => acc[id] = parseFloat(wage));
    return acc;
}, {});

// 创建axios实例
const axiosInstance = axios.create({
    baseURL: 'https://www.simcompanies.com',
    timeout: 5000
});

// 处理请求的通用函数
async function fetchData(url, options = {}) {
    try {
        const response = await axiosInstance.get(url, options);
        return response.data;
    } catch (error) {
        console.error(`Error fetching data from ${url}:`, error.message);
        return null;
    }
}

// 获取经济周期
async function get_economyState(sessionid) {
    const options = {
        headers: {
            "Cookie": `sessionid=${sessionid}`
        }
    };
    const data = await fetchData('/api/v2/companies/me/', options);
    
    if (data?.temporals?.hasOwnProperty('economyState')) {
        const economyState = data.temporals.economyState;
        console.log('Economy State:', economyState);
        return economyState;
    }

    return null;
}

// 获取市场饱和度和平均价格
async function getMarketData(realm_id) {
    const marketData = await fetchData(`/api/v4/${realm_id}/resources-retail-info`);
    if (!marketData) return {};

    return marketData.reduce((acc, item) => {
        acc[item.dbLetter] = {
            averagePrice: item.averagePrice,
            marketSaturation: item.saturation
        };
        return acc;
    }, {});
}

async function downloadAndExtractData(realm_id, economyState, marketData) {
    const url = await fetchScriptUrl();
    try {
        const content = await fetchData(url);
        
        const values = extractValuesFromJS(content);
        const jsonDataString = extractJsonString(content);

        if (jsonDataString) {
            try {
                const validJsonString = convertToValidJson(jsonDataString);
                const jsonData = JSON.parse(validJsonString);

                const extractedData = extractData(jsonData, realm_id, economyState, marketData);
                extractedData.PROFIT_PER_BUILDING_LEVEL = values.PROFIT_PER_BUILDING_LEVEL;
                extractedData.RETAIL_MODELING_QUALITY_WEIGHT = values.RETAIL_MODELING_QUALITY_WEIGHT;

                return extractedData;
            } catch (error) {
                console.error("JSON Parsing Error:", error.message);
            }
        } else {
            console.log("No valid JSON data found.");
        }
    } catch (error) {
        console.error('Error downloading or extracting data:', error.message);
    }

    return {};
}

// 获取脚本URL
async function fetchScriptUrl() {
    const html = await fetchData('/');
    const srcMatch = html.match(/crossorigin src="([^"]+)"/);

    if (srcMatch && srcMatch[1]) {
        return srcMatch[1];
    }

    console.log("Script URL not found");
    return null;
}

// 提取JSON字符串
function extractJsonString(content) {
    const jsonStringMatch = content.match(/\{0:\{1:\{buildingLevelsNeededPerHour:[\s\S]*?\}\}\}/);
    return jsonStringMatch ? jsonStringMatch[0] : null;
}

// 转换为有效的JSON格式
function convertToValidJson(jsonDataString) {
    return jsonDataString
        .replace(/([{,])(\s*)(\w+)(\s*):/g, '$1"$3":')
        .replace(/:\s*\.(\d+)/g, ': 0.$1');
}

// 提取JS文件中的变量值
function extractValuesFromJS(jsContent) {
    const profitValue = extractVariableValue(jsContent, 'PROFIT_PER_BUILDING_LEVEL');
    const retailValue = extractVariableValue(jsContent, 'RETAIL_MODELING_QUALITY_WEIGHT');

    return {
        PROFIT_PER_BUILDING_LEVEL: profitValue,
        RETAIL_MODELING_QUALITY_WEIGHT: retailValue
    };
}

// 提取变量值
function extractVariableValue(jsContent, key) {
    const regex = new RegExp(`${key}\\s*=\\s*([^,]+),`);
    const match = jsContent.match(regex);
    let value = match ? match[1].trim() : null;

    // 如果值以 "." 开头，修复为 "0."
    if (value && value.startsWith('.')) {
        value = '0' + value;
    }

    return value;
}

// 提取数据
function extractData(data, realm_id, economyState, marketData) {
    const rowData = {};
    const economyData = data[economyState] || {};

    for (let id in economyData) {
        const modelData = economyData[id];
        const marketInfo = marketData[id] || { averagePrice: 0, marketSaturation: 0 };

        rowData[id] = {
            averagePrice: marketInfo.averagePrice,
            marketSaturation: marketInfo.marketSaturation,
            building_wages: buildingWagesData[id] || 0,
            buildingLevelsNeededPerHour: modelData.buildingLevelsNeededPerHour,
            modeledProductionCostPerUnit: modelData.modeledProductionCostPerUnit,
            modeledStoreWages: modelData.modeledStoreWages,
            modeledUnitsSoldAnHour: modelData.modeledUnitsSoldAnHour
        };
    }

    return rowData;
}

// 获取模型数据
async function fetchDataAndProcess(sessionid, realm, realm_id, customEconomyState, customEconomyStateButton) {
    const economyState = customEconomyStateButton
        ? { '萧条': 0, '平缓': 1, '景气': 2 }[customEconomyState] || 1
        : await get_economyState(sessionid);

    const marketData = await getMarketData(realm_id);
    const rowData = await downloadAndExtractData(realm_id, economyState, marketData);

    // 保存数据到文件
    const fileName = `${realm}_data.json`;
    fs.writeFileSync(fileName, JSON.stringify(rowData, null, 2), 'utf-8');
    console.log(`Data saved to ${fileName}`);
}

// 获取命令行参数
const [sessionid = '', realm = 'r1', realm_id = '0', quality = '平缓', isDebug = 'false'] = process.argv.slice(2);

// 调用函数
fetchDataAndProcess(sessionid, realm, realm_id, quality, isDebug === 'true');