const axios = require('axios');
const fs = require('fs');

// 分类存放不同建筑工资
const categorizedBuildingWages = {
    //电子产品商店跟五金
    "172.5": [102, 103, 108, 109, 110, 24, 25, 26, 27, 28, 98],
    //加油站
    "345": [11, 12],
    //时装商店
    "310.5": [60, 61, 62, 63, 64, 65, 70, 71],
    //生鲜商店
    "138": [3, 4, 5, 7, 8, 9, 67, 119, 122, 123, 124, 125, 126, 127, 140, 144],
    //车行
    "379.5": [53, 54, 55, 56, 57],
    
};

// 生成建筑工资数据表
const buildingWagesData = {};

Object.entries(categorizedBuildingWages).forEach(([wage, ids]) => {
    ids.forEach(id => {
        buildingWagesData[id] = parseFloat(wage);
    });
});



// 获取经济周期
async function get_economyState(sessionid) {
    const url = "https://www.simcompanies.com/api/v2/companies/me/";
    const cookies = { "sessionid": sessionid };
    const options = {
        headers: {
            "Cookie": Object.keys(cookies).map(key => `${key}=${cookies[key]}`).join("; ")
        }
    };

    try {
        const response = await axios.get(url, options);
        const data = response.data;

        if (data && data.temporals && data.temporals.hasOwnProperty('economyState')) {
            const economyState = data.temporals.economyState;
            console.log('Economy State:', economyState);
            return economyState;
        }
    } catch (error) {
        console.error('Error fetching economy state:', error.message);
    }

    return null;
}

// 获取市场饱和度和平均价格
async function getMarketData(realm_id) {
    const url = `https://www.simcompanies.com/api/v4/${realm_id}/resources-retail-info`;

    try {
        const response = await axios.get(url);
        const marketData = response.data;
        const marketDataMap = {};

        marketData.forEach(item => {
            marketDataMap[item.dbLetter] = {
                averagePrice: item.averagePrice,
                marketSaturation: item.saturation
            };
        });

        return marketDataMap;
    } catch (error) {
        console.error('Error fetching market data:', error.message);
        return {};
    }
}


async function downloadAndExtractData(realm_id, economyState, marketData) {
    const url = await fetchScriptUrl();
    try {
        const response = await axios.get(url);
        const content = response.data;

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


async function fetchScriptUrl() {
    const url = 'https://www.simcompanies.com';
    const response = await axios.get(url);
    const html = response.data;

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
    jsonDataString = jsonDataString.replace(/([{,])(\s*)(\w+)(\s*):/g, '$1"$3":');
    jsonDataString = jsonDataString.replace(/:\s*\.(\d+)/g, ': 0.$1');
    return jsonDataString;
}

// 提取数据
function extractData(data, realm_id, economyState, marketData) {
    const rowData3 = {};

    if (data.hasOwnProperty(economyState)) {
        const economyData = data[economyState];

        for (let id in economyData) {
            const modelData = economyData[id];

            const buildingLevelsNeededPerHour = modelData.buildingLevelsNeededPerHour;
            const modeledProductionCostPerUnit = modelData.modeledProductionCostPerUnit;
            const modeledStoreWages = modelData.modeledStoreWages;
            const modeledUnitsSoldAnHour = modelData.modeledUnitsSoldAnHour;

            const marketInfo = marketData[id] || { averagePrice: 0, marketSaturation: 0 };

            rowData3[id] = {
                averagePrice: marketInfo.averagePrice,
                marketSaturation: marketInfo.marketSaturation,
                building_wages: buildingWagesData[id] || 0,
                buildingLevelsNeededPerHour,
                modeledProductionCostPerUnit,
                modeledStoreWages,
                modeledUnitsSoldAnHour
            };
        }
    }

    return rowData3;
}

// 提取JS文件中的变量值
function extractValuesFromJS(jsContent) {
    const profitVarName = extractVariableName(jsContent, 'PROFIT_PER_BUILDING_LEVEL');
    const retailVarName = extractVariableName(jsContent, 'RETAIL_MODELING_QUALITY_WEIGHT');

    const profitValue = extractVariableValue(jsContent, profitVarName);
    const retailValue = extractVariableValue(jsContent, retailVarName);

    return {
        PROFIT_PER_BUILDING_LEVEL: profitValue,
        RETAIL_MODELING_QUALITY_WEIGHT: retailValue
    };
}

// 提取变量名
function extractVariableName(jsContent, key) {
    const regex = new RegExp(key + '\\s*:\\s*(\\w+),');
    const match = jsContent.match(regex);
    return match ? match[1] : null;
}

// 提取变量值
function extractVariableValue(jsContent, variableName) {
    if (!variableName) return null;

    const regex = new RegExp(variableName + '\\s*=\\s*([^,]+),');
    const match = jsContent.match(regex);

    if (match) {
        let value = match[1].trim();

        // 如果值以 "." 开头，修复为 "0."
        if (value.startsWith('.')) {
            value = '0' + value;
        }

        return value;
    }

    return null;
}

// 获取模型数据
async function fetchDataAndProcess(sessionid, realm, realm_id, customEconomyState, customEconomyStateButton) {
    let economyState;
    if (customEconomyStateButton) {
        if (customEconomyState === '萧条') {
            economyState = 0;
        } else if (customEconomyState === '平缓') {
            economyState = 1;
        } else if (customEconomyState === '景气') {
            economyState = 2;
        }
    } else {
        economyState = await get_economyState(sessionid);
    }

    const marketData = await getMarketData(realm_id);
    
    // 检查ID为3的averagePrice，如果等于0则退出程序
    if (marketData[3] && marketData[3].averagePrice === 0) {
        console.log('ID为3的averagePrice为0，退出程序。');
        return; // 直接退出函数，不执行后续操作
    }
    
    const rowData1 = await downloadAndExtractData(realm_id, economyState, marketData);
   // console.log(rowData1);

    // 保存数据到文件
    const fileName = `${realm}_data.json`;
    fs.writeFileSync(fileName, JSON.stringify(rowData1, null, 2), 'utf-8');
    console.log(`Data saved to ${fileName}`);
}

// 获取命令行参数
const args = process.argv.slice(2);

// 解析参数
const sessionid = args[0] || '';  // 使用sessionid可获取到api中的周期
const dataFile = args[1] || 'r1';  // 服务器名称 输出文件名使用
const mode = args[2] || '0';  // 服务器id r1：0   r2：1
const quality = args[3] || '平缓';  // 自定义周期 '平缓'
const isDebug = args[4] === 'true';  // 是否使用自定义周期，否就使用api获取

// 调用函数
fetchDataAndProcess(sessionid, dataFile, mode, quality, isDebug);


