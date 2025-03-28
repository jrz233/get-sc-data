const axios = require('axios');
const fs = require('fs');

// 获取命令行参数
const args = process.argv.slice(2);
const realm = args[0];
const isDebug = (args[1] === 'true');

console.log(`服务器 ID: ${realm}`);
console.log(`Debug 模式: ${isDebug ? '已启用' : '未启用'}`);

// 输出日志函数
function log(message) {
    if (isDebug) {
        console.log(message);
    }
}

// 提取变量名
function extractVariableName(jsContent, key) {
    // 使用非贪婪匹配查找键对应的变量名
    const regex = new RegExp(key + '\\s*:\\s*([\\w$]+)', 'g'); // 这里直接匹配变量名
    const match = jsContent.match(regex);
    
    if (match) {
        const variableName = match[0].split(':')[1].trim(); // 获取匹配的变量名
        log(`${key} 匹配到的变量名：${variableName}`);
        return variableName;
    } 
    console.log(`未找到 ${key} 匹配的变量名`);
    return null;
}
// 提取变量值（匹配模式：0 - 简单值，1 - 复杂对象, 2 - 简单对象）
function extractVariableValue(jsContent, variableName, mode) {
    if (!variableName) return null;

    // 处理包含特殊符号的变量名，确保正则表达式可以正确匹配
    const escapedVariableName = variableName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    log(`正在提取变量：${variableName}`);

    if (mode === 1) {
        // 复杂对象模式
        let braceLevel = 0;
        let startIndex = jsContent.indexOf(variableName);
        if (startIndex !== -1) {
            startIndex = jsContent.indexOf('=', startIndex) + 1;
            for (let i = startIndex; i < jsContent.length; i++) {
                if (jsContent[i] === '{') {
                    if (braceLevel === 0) startIndex = i;
                    braceLevel++;
                } else if (jsContent[i] === '}') {
                    braceLevel--;
                    if (braceLevel === 0) {
                        return jsContent.substring(startIndex, i + 1).trim(); // 返回原始的对象字面量字符串
                    }
                }
            }
        }
    } else if (mode === 2) {
        // 单层对象模式（返回原始字符串）
        let regex = new RegExp(escapedVariableName + '\\s*[=:]\\s*(\\{[^}]*\\})', 's');
        let match = jsContent.match(regex);
        
        if (match) {
            let objectLiteral = match[1].trim();            
            // 将以小数点开头的值补全
            objectLiteral = objectLiteral.replace(/:\s*\.(\d+)/g, ': 0.$1');
            return objectLiteral;
        } else {
            console.log(`未找到匹配的对象字面量`);
        }
    } else {
        // 简单值模式
        let regex = new RegExp(escapedVariableName + '\\s*=\\s*([^,;\\n]+)[,;\\n]');
        let match = jsContent.match(regex);
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
    const adjustmentVarName = extractVariableName(jsContent, 'RETAIL_ADJUSTMENT');
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
        process.exit(1);
    }
    const salesValue = JSON.parse(extractVariableValue(jsContent, salesVarName, 2).replace(/(\w+)\s*:/g, '"$1":'));
    log("建筑数据: " + JSON.stringify(salesValue, null, 2));
    if (!salesValue || (typeof salesValue === 'object' && Object.keys(salesValue).length === 0)) {
        console.log('获取错误，退出程序。');
        process.exit(1);
    }
   
    const adjustmentValue = extractVariableValue(jsContent, adjustmentVarName, 2);
    console.log("建筑零售调整数据: " + JSON.stringify(adjustmentValue, null, 2));
    if (adjustmentValue === null) {
        console.log('获取错误退出程序。');
        process.exit(1);
    }

    const averageValue = parseFloat(extractVariableValue(jsContent, averageVarName, 0));
    log("平均工资: " + averageValue);
    if (averageValue === null) {
        console.log('获取错误退出程序。');
        process.exit(1);
    }
    const buildingDetails = extractBuildingDetails(jsContent);
    log("建筑详细信息: " + JSON.stringify(buildingDetails, null, 2));
    if (buildingDetails === null) {
        console.log('获取错误退出程序。');
        process.exit(1);
    }
    
    return {
        PROFIT_PER_BUILDING_LEVEL: profitValue,
        RETAIL_MODELING_QUALITY_WEIGHT: retailValue,
        SALES: salesValue,
        AVERAGE_SALARY: averageValue,
        BUILDING_DETAILS: buildingDetails,
        RETAIL_ADJUSTMENT: adjustmentValue,
    };
}


// 根据销售数据和零售调整数据生成调整映射
function getRetailAdjustmentByItemID(salesData, retailAdjustmentData) {
    // 解析零售调整数据
    const adjustmentMap = JSON.parse(
        retailAdjustmentData.replace(/(\w+)\s*:/g, '"$1":')
    );

    // 创建物品 ID 到零售调整值的映射
    const itemAdjustmentMap = {};

    // 遍历销售数据
    for (const [buildingID, items] of Object.entries(salesData)) {
        const adjustmentValue = adjustmentMap[buildingID]; // 获取该建筑的调整值
        for (const itemID of items) {
            itemAdjustmentMap[itemID] = adjustmentValue !== undefined ? adjustmentValue : null;
        }
    }

    return itemAdjustmentMap;
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

function extractJsonString(jsContent, economyState) {
    let regexPattern;
    switch (economyState) {
        case 0:
            regexPattern = /0:\s*JSON\.parse\('([\s\S]*?)'\)/;
            break;
        case 1:
            regexPattern = /1:\s*JSON\.parse\('([\s\S]*?)'\)/;
            break;
        case 2:
            regexPattern = /2:\s*JSON\.parse\('([\s\S]*?)'\)/;
            break;
        default:
            return null;
    }
    const match = jsContent.match(regexPattern);
    return match ? match[1] : null;
}


function convertToValidJson(jsonDataString) {
    // 添加数组格式转换
    const fixedArrayString = jsonDataString
        .replace(/(\w+):\[/g, '"$1":[')  // 处理数组开头的key
        .replace(/],(\w+):/g, '],"$1":'); // 处理数组结尾的key
    
    return fixedArrayString
        .replace(/\\'/g, '"')
        .replace(/([{,])(\s*)(\w+)(\s*):/g, '$1"$3":')
        .replace(/:\s*\.(\d+)/g, ': 0.$1');
}

// 提取数据
function extractData(data, realm, economyState, marketData, buildingWagesData) {
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
                    buildingLevelsNeededPerUnitPerHour: modelData.buildingLevelsNeededPerUnitPerHour,
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
    try {
        const response = await axios.get(url);
        const html = response.data;
        const srcMatch = html.match(/crossorigin src="([^"]+)"/);
        if (srcMatch && srcMatch[1]) {
            return srcMatch[1];
        }
        console.log("未找到脚本 URL");
        process.exit(1);
    } catch (error) {
        console.error('获取脚本 URL 时出错:', error.message);
        process.exit(1);
    }
}

async function fetchScriptData(scriptUrl) {
    try {
        const response = await axios.get(scriptUrl);
        return response.data;
    } catch (error) {
        console.error('获取脚本内容时出错:', error.message);
        process.exit(1);
    }
}

// 获取市场饱和度和平均价格
async function getMarketData(realm) {
    const url = `https://www.simcompanies.com/api/v4/${realm}/resources-retail-info`;
    try {
        const response = await axios.get(url);
        const marketData = response.data;
        const marketDataMap = {};

        marketData.forEach(item => {
            if (item.dbLetter === 150) {
                // 针对 150 的品质进行特殊处理
                if (!marketDataMap[150]) {
                    marketDataMap[150] = {};
                }
                marketDataMap[150][item.quality] = {
                    averagePrice: item.averagePrice,
                    marketSaturation: item.saturation
                };
            } else {
                marketDataMap[item.dbLetter] = {
                    averagePrice: item.averagePrice,
                    marketSaturation: item.saturation
                };
            }
        });

        return marketDataMap;
    } catch (error) {
        console.error('获取市场数据时出错:', error.message);
        process.exit(1);
    }
}

async function ExtractData(realm, economyState, marketData, scriptContent) {
    const jsonDataString = extractJsonString(scriptContent, economyState);
    if (!jsonDataString) {
        console.log("未找到有效的 JSON 数据。");
        process.exit(1);
    }

    try {
        const validJsonString = convertToValidJson(jsonDataString);
        const parsedData = JSON.parse(validJsonString);

        // 重构数据处理逻辑
        const resultData = processModelData(parsedData);
        
        // 合并市场数据
        return mergeMarketData(resultData, marketData, economyState, scriptContent);
    } catch (error) {
        console.error("JSON 解析错误:", error.message);
        process.exit(1);
    }
}

function processModelData(parsedData) {
    const result = {};
    for (const [id, modelData] of Object.entries(parsedData)) {
        result[id] = {};

        // 处理quality数据类型（数组/对象）
        if (modelData.quality) {
            // 如果是数组直接遍历
            if (Array.isArray(modelData.quality)) {
                modelData.quality.forEach((qualityData, index) => {
                    result[id][index] = extractModelFields(qualityData);
                });
            } 
            // 如果是对象则遍历对象属性
            else if (typeof modelData.quality === 'object') {
                for (const [qualityKey, qualityData] of Object.entries(modelData.quality)) {
                    result[id][qualityKey] = extractModelFields(qualityData);
                }
            }
        } else {
            // 没有quality时直接处理
            result[id] = extractModelFields(modelData);
        }
    }
    return result;
}


function extractModelFields(data) {
    return {
        buildingLevelsNeededPerUnitPerHour: data.buildingLevelsNeededPerUnitPerHour,
        modeledProductionCostPerUnit: data.modeledProductionCostPerUnit,
        modeledStoreWages: data.modeledStoreWages,
        modeledUnitsSoldAnHour: data.modeledUnitsSoldAnHour
    };
}

async function mergeMarketData(resultData, marketData, economyState, scriptContent) {
    const values = extractValuesFromJS(scriptContent);
    const buildingWagesData = calculateBuildingWages(
        values.AVERAGE_SALARY,
        values.SALES,
        values.BUILDING_DETAILS
    );
    const adjustmentData = getRetailAdjustmentByItemID(
        values.SALES,
        values.RETAIL_ADJUSTMENT
    );

    // 合并市场数据逻辑（调整字段顺序）
    for (const id in resultData) {
        if (id === '150') {
            for (const quality in resultData[id]) {
                const marketInfo = (marketData[150] && marketData[150][quality]) || {};
                resultData[id][quality] = {
                    // 显式定义字段顺序
                    averagePrice: marketInfo.averagePrice || 0,
                    marketSaturation: marketInfo.marketSaturation || 0,
                    building_wages: buildingWagesData[id] || 0,
                    // 合并模型数据
                    ...resultData[id][quality],
                    // 添加调整数据
                    retail_adjustment: adjustmentData[id] || null
                };
            }
        } else {
            const marketInfo = marketData[id] || {};
            resultData[id] = {
                // 显式定义字段顺序
                averagePrice: marketInfo.averagePrice || 0,
                marketSaturation: marketInfo.marketSaturation || 0,
                building_wages: buildingWagesData[id] || 0,
                // 合并模型数据
                ...resultData[id],
                // 添加调整数据
                retail_adjustment: adjustmentData[id] || null
            };
        }
    }

    // 过滤逻辑
    const filteredData = {};
    for (const [id, data] of Object.entries(resultData)) {
        // 跳过全局参数
        if (['PROFIT_PER_BUILDING_LEVEL', 'RETAIL_MODELING_QUALITY_WEIGHT'].includes(id)) continue;

        if (id !== '150') {
            if (data.modeledStoreWages !== null && data.modeledStoreWages !== undefined) {
                // 创建新对象保证字段顺序
                filteredData[id] = {
                    averagePrice: data.averagePrice,
                    marketSaturation: data.marketSaturation,
                    building_wages: data.building_wages,
                    ...data
                };
            }
        } else {
            const validQualities = {};
            for (const [qualityKey, qualityData] of Object.entries(data)) {
                if (qualityData.modeledStoreWages !== null && qualityData.modeledStoreWages !== undefined) {
                    // 创建新对象保证字段顺序
                    validQualities[qualityKey] = {
                        averagePrice: qualityData.averagePrice,
                        marketSaturation: qualityData.marketSaturation,
                        building_wages: qualityData.building_wages,
                        ...qualityData
                    };
                }
            }
            if (Object.keys(validQualities).length > 0) {
                filteredData[id] = validQualities;
            }
        }
    }

    // 保留全局参数
    filteredData.PROFIT_PER_BUILDING_LEVEL = values.PROFIT_PER_BUILDING_LEVEL;
    filteredData.RETAIL_MODELING_QUALITY_WEIGHT = values.RETAIL_MODELING_QUALITY_WEIGHT;

    return filteredData;
}


// 主函数调用
async function fetchDataAndProcess(realm) {
    // 1. 获取市场数据
    const marketData = await getMarketData(realm);

    // 2. 获取脚本 URL 和内容
    const scriptUrl = await fetchScriptUrl();
    const scriptContent = await fetchScriptData(scriptUrl);

    // 3. 循环处理每个经济周期
    for (let economyState = 0; economyState <= 2; economyState++) {
        const extractedData = await ExtractData(realm, economyState, marketData, scriptContent);

        // 保存数据到文件
        const fileName = `${realm}_${economyState}_data.json`;
        fs.writeFileSync(fileName, JSON.stringify(extractedData, null, 2), 'utf-8');
        console.log(`经济周期 ${economyState} 的数据已保存到 ${fileName}`);
    }
}

// 调用主函数
fetchDataAndProcess(realm);


