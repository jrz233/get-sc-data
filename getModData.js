const axios = require('axios');
const fs = require('fs');

// 获取命令行参数
const args = process.argv.slice(2);
const sessionid = args[0] || ''; // sessionid
const dataFile = args[1] || 'r1'; //文件名称
const mode = args[2] || '0';  //服务器id
const customEconomyState = args[3] || '平缓'; //周期
const customEconomyStateButton = args[4] || 'true'; //是否自定义周期
const isDebug = args[5] || 'false'; //debug

// 输出日志函数
function log(message) {
    if (isDebug) {
        console.log(message);
    }
}

// 提取变量名
function extractVariableName(jsContent, key) {
    // 使用非贪婪匹配查找键对应的变量名
    const regex = new RegExp(key + '\\s*:\\s*([\\w$]+),');
    const match = jsContent.match(regex);
    return match ? match[1] : null;
}

// 提取变量值（匹配模式：0 - 简单值，1 - 复杂对象）
function extractVariableValue(jsContent, variableName, mode) {
    if (!variableName) return null;

    // 处理包含特殊符号的变量名，确保正则表达式可以正确匹配
    const escapedVariableName = variableName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

    let regex;
    let match;

    if (mode === 1) {
        // 匹配复杂对象
        regex = new RegExp(escapedVariableName + '\\s*=\\s*(\\{[\\s\\S]*?\\})', 'i');
        match = jsContent.match(regex);
        if (match) {
            let value = match[1].trim();
            return value;
        }
    } else {
        // 匹配简单值
        regex = new RegExp(escapedVariableName + '\\s*=\\s*([^,;\\n]+)[,;\\n]');
        match = jsContent.match(regex);
        if (match) {
            let value = match[1].trim();
            if (value.startsWith('.')) {
                value = '0' + value; // 处理值以小数点开头的情况
            }
            return value;
        }
    }

    console.log(`在提供的 JS 内容中找不到 ${variableName} 的值`);
    return null;
}


// 提取JS文件中的变量值
function extractValuesFromJS(jsContent) {
    const profitVarName = extractVariableName(jsContent, 'PROFIT_PER_BUILDING_LEVEL');
    const retailVarName = extractVariableName(jsContent, 'RETAIL_MODELING_QUALITY_WEIGHT');
    const salesVarName = extractVariableName(jsContent, 'SALES');
    const averageVarName = extractVariableName(jsContent, 'AVERAGE_SALARY');

    const profitValue = extractVariableValue(jsContent, profitVarName, 0);
    log("每级建筑利润: " + profitValue);
    if (profitValue === null) {
        console.log('获取错误退出程序。');
        process.exit(1);
    }
    const retailValue = extractVariableValue(jsContent, retailVarName, 0);
    log("品质权重: " + retailValue);
    if (retailValue === null) {
        console.log('获取错误退出程序。');
        return;
    }
    const salesValue = JSON.parse(extractVariableValue(jsContent, salesVarName, 1).replace(/(\w+)\s*:/g, '"$1":'));
    log("建筑数据: " + JSON.stringify(salesValue, null, 2));
    if (salesValue === null) {
        console.log('获取错误退出程序。');
        return;
    }
    const averageValue = parseFloat(extractVariableValue(jsContent, averageVarName, 0));
    log("平均工资: " + averageValue);
    if (averageValue === null) {
        console.log('获取错误退出程序。');
        return;
    }
    const buildingDetails = extractBuildingDetails(jsContent);
    log("建筑详细信息: " + JSON.stringify(buildingDetails, null, 2));
    if (buildingDetails === null) {
        console.log('获取错误退出程序。');
        return;
    }
    
    return {
        PROFIT_PER_BUILDING_LEVEL: profitValue,
        RETAIL_MODELING_QUALITY_WEIGHT: retailValue,
        SALES: salesValue,
        AVERAGE_SALARY: averageValue,
        BUILDING_DETAILS: buildingDetails,
    };
}

// 提取建筑详细信息
function extractBuildingDetails(jsContent) {
    const buildingDetails = {};
    const singleBuildingRegex = /(\w+)\s*=\s*\{\s*dbLetter\s*:\s*"(\w+)",[\s\S]*?salaryModifier\s*:\s*([\d.]+)/g;
    let match;
    while ((match = singleBuildingRegex.exec(jsContent)) !== null) {
        const buildingName = match[1];
        const dbLetter = match[2];
        const salaryModifier = parseFloat(match[3]);
        buildingDetails[dbLetter] = { buildingName, dbLetter, salaryModifier };
    }

    const complexBuildingRegex = /(\w+)\s*=\s*\{\s*([\s\S]*?)\};/g;
    while ((match = complexBuildingRegex.exec(jsContent)) !== null) {
        const complexObjectName = match[1];
        const complexObjectContent = match[2];
        const subObjectRegex = /\d+\s*:\s*\{\s*dbLetter\s*:\s*"(\w+)",[\s\S]*?salaryModifier\s*:\s*([\d.]+)/g;
        let subMatch;
        while ((subMatch = subObjectRegex.exec(complexObjectContent)) !== null) {
            const dbLetter = subMatch[1];
            const salaryModifier = parseFloat(subMatch[2]);
            buildingDetails[dbLetter] = { buildingName: complexObjectName, dbLetter, salaryModifier };
        }
    }
    return buildingDetails;
}

// 根据建筑详细信息和销售数据计算建筑工资
function calculateBuildingWages(averageSalary, salesData, buildingDetails) {
    const buildingWagesData = {};
    for (const [buildingName, ids] of Object.entries(salesData)) {
        if (buildingName === 'r') {
            log(`跳过餐馆的工资计算`);
            continue;
        }
        if (buildingDetails[buildingName]) {
            const salaryModifier = buildingDetails[buildingName].salaryModifier;
            const buildingWage = parseFloat((averageSalary * salaryModifier).toFixed(2));
            ids.forEach((id) => {
                buildingWagesData[id] = buildingWage;
            });
        }
    }
    log("建筑工资数据: " + JSON.stringify(buildingWagesData, null, 2));
    return buildingWagesData;
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
function extractData(data, realm_id, economyState, marketData, buildingWagesData) {
    const rowData3 = {};
    if (data.hasOwnProperty(economyState)) {
        const economyData = data[economyState];
        for (let id in economyData) {
            const modelData = economyData[id];
            const marketInfo = marketData[id] || { averagePrice: 0, marketSaturation: 0 };
            if (marketInfo.averagePrice >= 0.1 && marketInfo.marketSaturation !== 0) {
                rowData3[id] = {
                    averagePrice: marketInfo.averagePrice,
                    marketSaturation: marketInfo.marketSaturation,
                    building_wages: buildingWagesData[id] || 0,
                    buildingLevelsNeededPerHour: modelData.buildingLevelsNeededPerHour,
                    modeledProductionCostPerUnit: modelData.modeledProductionCostPerUnit,
                    modeledStoreWages: modelData.modeledStoreWages,
                    modeledUnitsSoldAnHour: modelData.modeledUnitsSoldAnHour,
                };
            }
        }
    }
    return rowData3;
}

// 获取脚本 URL
async function fetchScriptUrl() {
    const url = 'https://www.simcompanies.com';
    const response = await axios.get(url);
    const html = response.data;
    const srcMatch = html.match(/crossorigin src="([^"]+)"/);
    if (srcMatch && srcMatch[1]) {
        return srcMatch[1];
    }
    console.log("未找到脚本 URL");
    return null;
}

// 获取经济周期
async function get_economyState(sessionid) {
    const url = "https://www.simcompanies.com/api/v2/companies/me/";
    const cookies = { "sessionid": sessionid };
    const options = {
        headers: { "Cookie": Object.keys(cookies).map(key => `${key}=${cookies[key]}`).join("; ") }
    };
    try {
        const response = await axios.get(url, options);
        const data = response.data;
        if (data && data.temporals && data.temporals.hasOwnProperty('economyState')) {
            const economyState = data.temporals.economyState;
            log('经济周期: ' + economyState);
            return economyState;
        }
    } catch (error) {
        console.error('获取经济周期时出错:', error.message);
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
        console.error('获取市场数据时出错:', error.message);
        return {};
    }
}

// 下载并提取数据
async function downloadAndExtractData(realm_id, economyState, marketData) {
    const url = await fetchScriptUrl();
    try {
        const response = await axios.get(url);
        const content = response.data;
        const values = extractValuesFromJS(content);
        const buildingWagesData = calculateBuildingWages(values.AVERAGE_SALARY, values.SALES, values.BUILDING_DETAILS);
        const jsonDataString = extractJsonString(content);
        if (jsonDataString) {
            try {
                const validJsonString = convertToValidJson(jsonDataString);
                const jsonData = JSON.parse(validJsonString);
                const extractedData = extractData(jsonData, realm_id, economyState, marketData, buildingWagesData);
                extractedData.PROFIT_PER_BUILDING_LEVEL = values.PROFIT_PER_BUILDING_LEVEL;
                extractedData.RETAIL_MODELING_QUALITY_WEIGHT = values.RETAIL_MODELING_QUALITY_WEIGHT;
                return extractedData;
            } catch (error) {
                console.error("JSON 解析错误:", error.message);
                process.exit(1);
            }
        } else {
            console.log("未找到有效的 JSON 数据。");
            process.exit(1);
        }
    } catch (error) {
        console.error('下载或提取数据时出错:', error.message);
        process.exit(1);
    }
    return {};
}

// 主函数调用
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

    if (marketData[3] && (!marketData[3].averagePrice || marketData[3].averagePrice < 0.1)) {
        console.log('数据错误，退出程序。');
        return;
    }

    const rowData1 = await downloadAndExtractData(realm_id, economyState, marketData);
    
    const fileName = `${realm}_data.json`;
    fs.writeFileSync(fileName, JSON.stringify(rowData1, null, 2), 'utf-8');
    console.log(`数据已保存到 ${fileName}`);
}

// 调用主函数
fetchDataAndProcess(sessionid, dataFile, mode, customEconomyState, customEconomyStateButton);
