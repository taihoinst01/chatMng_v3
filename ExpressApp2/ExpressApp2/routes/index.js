'use strict';
var express = require('express');
var Client = require('node-rest-client').Client;
var sql = require('mssql');
var dbConfig = require('../config/dbConfig');
var dbConnect = require('../config/dbConnect');
var luisConfig = require('../config/luisConfig');
var i18n = require("i18n");
const syncClient = require('sync-rest-client');
const appDbConnect = require('../config/appDbConnect');
const appSql = require('mssql');
var router = express.Router();

const HOST = 'https://westus.api.cognitive.microsoft.com'; // Luis api host
var subKey = luisConfig.subKey; // Subscription Key
var saveAppList;
/* GET home page. */
router.get('/', function (req, res) {
    if(req.session.sid) {
        var userId = req.session.sid;
        try{
            //등록된 앱 있는지 조회
            var UserAppListStr = "SELECT COUNT(*) AS COUNT FROM TBL_USER_RELATION_APP WHERE USER_ID = '" + userId + "';";
                  
            (async () => {
                try {
                    let pool = await dbConnect.getConnection(sql);
                    let appList = await pool.request().query(UserAppListStr);
                    let rows = appList.recordset;
                    if(rows[0].COUNT == 0) {
                        if(userId == 'admin') {
                            res.send('<script>alert("등록된 앱이 없음으로 관리자 화면으로 이동합니다");location.href="/users/userMng";</script>')
                        } else {
                            req.session.destroy(function (err) { 
                                if (err) { 
                                    console.log(err); 
                                } else { 
                                    res.clearCookie('sid');                  
                                    res.send('<script>alert("등록된 앱이 없습니다 관리자에게 문의해주세요");location.href="/";</script>')
                                }
                            });
                        }
                    } else {
                        //db정보 조회 start-----
                        await dbConnect.getConnection(sql).then(pool => { 
                            return pool.request().query( "SELECT USER_NAME, PASSWORD, SERVER, DATABASE_NAME, APP_NAME, APP_ID FROM TBL_DB_CONFIG;" ) 
                        }).then(result => {
                            let dbValue = result.recordset;
                            req.session.dbValue = dbValue;

                            var getSimulUrlStr = "SELECT ISNULL(" +
                                                "(SELECT CNF_VALUE FROM TBL_CHATBOT_CONF WHERE CNF_TYPE = 'SIMULATION_URL' AND CNF_NM = '" + userId + "'), " +
                                                "(SELECT CNF_VALUE FROM TBL_CHATBOT_CONF WHERE CNF_TYPE = 'SIMULATION_URL' AND CNF_NM = 'admin'))  AS SIMUL_URL";
                            dbConnect.getConnection(sql).then(pool => { 
                                return pool.request().query( getSimulUrlStr ) 
                            }).then(result => {
                                
                                req.session.simul_url = result.recordset[0].SIMUL_URL;

                            }).catch(err => {
                                console.log(err);
                                sql.close();
                            });

                        }).catch(err => {
                            console.log(err);
                            sql.close();
                        });
                        //db정보 조회 end----

                        var subsKeyList;
                        await dbConnect.getConnection(sql).then(pool => { 
                            return pool.request().query( "SELECT CNF_VALUE FROM TBL_CHATBOT_CONF WHERE CNF_TYPE = 'LUIS_SUBSCRIPTION' GROUP BY CNF_VALUE; " ) 
                        }).then(result => {
                            subsKeyList = result.recordset;
                        }).catch(err => {
                            console.log(err);
                            sql.close();
                        });


                        //여기서부터 동기화 입니다.
                        /*
                        루이스 아이디가 틀릴때는 문제가 될수가 있다
                        임시로 동기화 중지
                        */
                       if(userId == 'adminSync') {
                        //if(userId == 'admin') {

                            await dbConnect.getConnection(sql).then(pool => {
                                return pool.request().query( "SELECT SUBSC_KEY, APP_NAME, APP_ID FROM TBL_LUIS_APP;" ) 
                            }).then(result => {
                                var rows = result.recordset;
                                //var client = new Client();

                                
                                for(var u = 0 ; u < subsKeyList.length; u++) {
                                    var options = {
                                        headers: {
                                            'Ocp-Apim-Subscription-Key': subsKeyList[u].CNF_VALUE//subKey
                                        }
                                    };

                                    var luisAppList = syncClient.get( HOST + '/luis/api/v2.0/apps/', options); 

                                    //console.log(data)
                                    var appList = luisAppList['body'];
                                    saveAppList = JSON.parse(JSON.stringify(luisAppList['body']));
                                    var chatConfQry = "";

                                    
                                    var newAppList = [];
                                    var deleteAppStr = "";
                                    
                                    for (var i = 0; i < rows.length; i++) {
                                        //luis에서 삭제한 app check
                                        var chkDelApp = true;
                                        if (subsKeyList[u].CNF_VALUE == rows[i].SUBSC_KEY) {

                                            for (var j=0; j<appList.length; j++) {
                                                
                                                //db - luis상 app name이 같으면
                                                if (rows[i].APP_NAME === appList[j].name) {
                                                    
                                                    if (rows[i].APP_ID === appList[j].id) {
                                                        //db에 존재하는 앱은 제외
                                                        appList.splice(j,1);
                                                    } else {
                                                        //기존 앱이 삭제되고 같은 이름의 새 앱이 생긴 경우
                                                        console.log("delete1=====");
                                                        deleteAppStr += "DELETE FROM TBL_LUIS_APP WHERE APP_NAME = '" + rows[i].APP_NAME + "' AND APP_ID = '" + rows[i].APP_ID + "'; \n";
                                                        deleteAppStr += "DELETE FROM TBL_CHAT_RELATION_APP WHERE APP_ID = '" + rows[i].APP_ID + "'; \n";
                                                        
                                                        //chatConfQry += "UPDATE TBL_CHATBOT_CONF SET CNF_VALUE = '" + rows[i].APP_ID + "' WHERE CNF_NM = '" + rows[i].APP_NAME + "'"
                                                    }

                                                    chkDelApp = false;
                                                    break;
                                                }
                                            }

                                            if (chkDelApp) {
                                                console.log("delete2=====");
                                                deleteAppStr += "DELETE FROM TBL_LUIS_APP WHERE APP_NAME = '" + rows[i].APP_NAME + "' AND APP_ID = '" + rows[i].APP_ID + "'; \n";
                                                deleteAppStr += "DELETE FROM TBL_CHAT_RELATION_APP WHERE APP_ID = '" + rows[i].APP_ID + "'; \n";
                                                //chatConfQry += "DELETE FROM TBL_CHATBOT_CONF CNF_NM = '" + rows[i].APP_NAME + "'; \n";
                                            }
                                        }
                                    }
        
                                    if (appList.length > 0 || deleteAppStr !== "") {
                                        var appStr = "";
                                        var appRelationStr = "";
                                        for (var i=0; i<appList.length; i++) {
                                            if (req.query.appInsertName) {
                                                var appColor = (req.query.appInsertName === appList[i].name?req.query.appColor: 'color_01');
                                                appStr += "INSERT INTO TBL_LUIS_APP (APP_NUM, SUBSC_KEY, APP_ID, VERSION, APP_NAME, OWNER_EMAIL, REG_DT, CULTURE, DESCRIPTION, APP_COLOR) \n";
                                                appStr += "VALUES ((SELECT isNULL(MAX(APP_NUM),0) FROM TBL_LUIS_APP)+1, '" + subsKeyList[u].CNF_VALUE + "', '" + appList[i].id + "', \n" +
                                                    " '" + appList[i].activeVersion + "', '" + appList[i].name + "', '" + appList[i].ownerEmail + "', \n" +
                                                    " convert(VARCHAR(33), '" + appList[i].createdDateTime + "', 126), '" + appList[i].culture + "', '" + appList[i].description + "', " +
                                                    " '" + appColor + "'); \n";

                                                /*var userId = req.session.sid;
                                                appStr += "INSERT INTO TBL_USER_RELATION_APP(USER_ID, APP_ID) " +
                                                "     VALUES ('" + userId + "', '" + appList[i].id + "'); \n";    */
                                            } else {

                                                var tmp = Math.floor(Math.random() * (15 - 1)) + 1;
                                                var randNum = pad(tmp, 2);
                                                appStr += "INSERT INTO TBL_LUIS_APP (APP_NUM, SUBSC_KEY, APP_ID, VERSION, APP_NAME, OWNER_EMAIL, REG_DT, CULTURE, DESCRIPTION, APP_COLOR) \n";
                                                appStr += "VALUES ((SELECT isNULL(MAX(APP_NUM),0) FROM TBL_LUIS_APP)+1, '" + subsKeyList[u].CNF_VALUE + "', '" + appList[i].id + "', \n" +
                                                    " '" + appList[i].activeVersion + "', '" + appList[i].name + "', '" + appList[i].ownerEmail + "', \n" +
                                                    " convert(VARCHAR(33), '" + appList[i].createdDateTime + "', 126), '" + appList[i].culture + "', '" + appList[i].description + "', " +
                                                    " 'color_" + randNum + "'); \n";
                                            }
                                        }
                                        //convert(datetime, '2008-10-23T18:52:47.513', 126)
                                        //let insertApp = await pool.request().query(appStr);
                                        sql.close();
                                        dbConnect.getConnection(sql).then(pool => { 
                                            return pool.request().query(deleteAppStr + appStr) 
                                        }).then(result => {
                                            sql.close();
                                        }).catch(err => {
                                            console.log(err);
                                            sql.close();
                                        });
                                    }                                                                                        
                                
                                }
                                sql.close();
                            }).catch(err => {
                                console.log(err);
                                sql.close();
                            })
                        }

                        res.redirect('/list');
                    } 
                    
                } catch (err) {
                    console.log(err);
                    res.send({status:500 , message:'app Load Error'});
                } finally {
                    sql.close();
                }
            })()

            sql.on('error', err => {
                // ... error handler
            })

                

        }catch(e){
            console.log(e);
        }
        
    }
    else{
        res.cookie('i18n', 'ko', { maxAge: 900000, httpOnly: true });
        res.render('login');   
    }
    
});

router.get('/list', function (req, res) {
    req.session.selMenu = 'm1';
    var loginId = req.session.sid;
    /*
    var userListStr = "SELECT A.APP_ID, A.VERSION, A.APP_NAME, FORMAT(A.REG_DT,'yyyy-MM-dd') REG_DT, A.CULTURE, A.DESCRIPTION, A.APP_COLOR \n" +
                      "  FROM TBL_LUIS_APP A, TBL_USER_RELATION_APP B \n" +
                      " WHERE 1=1 \n" +
                      "   AND A.APP_ID = B.APP_ID \n" +
                      "   AND B.USER_ID = '" + loginId + "'; \n";
    */
    var userListStr = " SELECT DISTINCT B.CHATBOT_NUM, B.CHATBOT_NAME, B.CULTURE, B.DESCRIPTION, B.APP_COLOR \n";
       userListStr += "   FROM TBL_USER_RELATION_APP A, TBL_CHATBOT_APP B \n";
       userListStr += "  WHERE A.USER_ID = '" + loginId + "'   \n";
       userListStr += "    AND A.CHAT_ID = B.CHATBOT_NUM;   \n";
    var rows;
    


    (async () => {
        try {

            let pool = await dbConnect.getAppConnection(sql);
            let rslt = await pool.request()
                .query(userListStr);
            rows = rslt.recordset;
            req.session.leftList = rows;
            var dbList = req.session.dbValue;
            if (typeof dbList === 'undefined') {
                res.render('appList');
            }
            sql.close();
            var chkIndex = 0;
            var chkIndexQry = 0;
            for (var i=0; i<rows.length; i++) {

                var cnt_query = "SELECT  (SELECT COUNT(DLG_ID) FROM TBL_DLG) AS DLG_CNT, \n" +
                                    "		(SELECT count(distinct GroupM) FROM TBL_DLG) AS INTENT_CNT, " + i + " AS I_INDEX;"

                var dbPool = await dbConnect.getAppConnection(appSql, rows[i].CHATBOT_NAME, req.session.dbValue);
                var result2 = await dbPool.request()
                    .query(cnt_query);

                chkIndex++;
                var rows2 = result2.recordset;
                rows[i].INTENT_CNT = rows2[0].INTENT_CNT;
                rows[i].DLG_CNT = rows2[0].DLG_CNT;
                sql.close();
                if ( chkIndex === rows.length) {
                    req.session.save(function(){
                        res.render('appList',
                        {
                            title: 'Express',
                            appName: req.session.appName,
                            selMenu: req.session.selMenu,
                            list: rows,
                            leftList: req.session.leftList
                        });
                    });
                }
            }
            
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()
});

router.get('/addChatbot', function (req, res) {
    req.session.selMenus = 'ms1';
    res.render('addChatbot');
});

//Chatbot App Insert
router.post('/admin/addChatBotApps', function (req, res){
    var chatName = req.body.appInsertName;
    var culture = req.body.appInsertCulture;
    var chatDes = req.body.appDes;
    var chatColor = req.body.color;
    var dbId = req.body.dbId;
    var dbPassword = req.body.dbPassword;
    var dbUrl = req.body.dbUrl;
    var dbName = req.body.dbName;
    var luisSubscription = req.body.luisSubscription;

    (async () => {
        try {
            var insertChatQuery_old = "INSERT INTO TBL_CHATBOT_APP(CHATBOT_NUM,CHATBOT_NAME,CULTURE,DESCRIPTION,APP_COLOR, LUIS_SUBSCRIPTION) ";
            insertChatQuery_old += "VALUES((SELECT ISNULL(MAX(CHATBOT_NUM),0) FROM TBL_CHATBOT_APP)+1, @chatName, @culture, @chatDes, @chatColor, @luisSubscription)";
            var insertChatQuery = "INSERT INTO TBL_CHATBOT_APP(CHATBOT_NUM,CHATBOT_NAME,CULTURE,DESCRIPTION,APP_COLOR) ";
            insertChatQuery += "VALUES((SELECT ISNULL(MAX(CHATBOT_NUM),0) FROM TBL_CHATBOT_APP)+1, @chatName, @culture, @chatDes, @chatColor)";

            var insertDbQuery = "INSERT INTO TBL_DB_CONFIG(USER_NAME,PASSWORD,SERVER,DATABASE_NAME,APP_NAME,APP_ID) ";
            insertDbQuery += "VALUES(@dbId, @dbPassword, @dbUrl, @dbName, @chatName, @chatName)";

            let pool = await dbConnect.getConnection(sql);
            let insertChat = await pool.request()
                .input('chatName', sql.NVarChar, chatName)
                .input('culture', sql.NVarChar, culture)
                .input('chatDes', sql.NVarChar, chatDes)
                .input('chatColor', sql.NVarChar, chatColor)
                //.input('luisSubscription', sql.NVarChar, luisSubscription)
                .query(insertChatQuery);

            let insertDb = await pool.request()
                .input('dbId', sql.NVarChar, dbId)
                .input('dbPassword', sql.NVarChar, dbPassword)
                .input('dbUrl', sql.NVarChar, dbUrl)
                .input('dbName', sql.NVarChar, dbName)
                .input('chatName', sql.NVarChar, chatName)
                .query(insertDbQuery);
            
            if(insertChat.rowsAffected.length > 0 && insertDb.rowsAffected.length > 0){
                res.send({result:true});
            } else {
                res.send({result:false});
            }
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()

});

//Luis app insert
router.post('/admin/putAddApps', function (req, res){
    var appService = req.body.appInsertService;
    var appName = req.body.appInsertName;
    var appCulture = req.body.appInsertCulture;
    var appDes = req.body.appDes;

    var client = new Client();
    
    var options = {
        headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': subKey
        },
        data: {
            'name': appName,
            'description': appDes,
            'culture': appCulture
        }
    };
    try{
        client.post( HOST + '/luis/api/v2.0/apps/', options, function (data, response) {
            //console.log(data); // app id값
            var responseData;
            if(response.statusCode == 201){ // 등록 성공

                //색상 등록
                responseData = {'appId': data};
            }else{
                responseData = data;
            }
            res.json(responseData);
        });
    }catch(e){
        console.log(e);
    }
});

//Luis app delete
router.post('/admin/deleteApp', function (req, res){
    var appId = req.body.deleteAppId;

    var client = new Client();
    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': subKey
        }
    };
    try{
        client.delete( HOST + '/luis/api/v2.0/apps/' + appId , options, function (data, response) {
            res.json(data);
        });
    }catch(e){
        console.log(e);
    }
    
});

//Luis app rename
router.post('/admin/renameApp', function (req, res){
    var appId = req.body.renameAppId;
    var appName = req.body.renameAppName;
    var client = new Client();
    var options = {
        headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': subKey
        },
        data: {
            'name': appName
        }
    };
    try{
        client.put( HOST + '/luis/api/v2.0/apps/' + appId , options, function (data, response) {
            res.json(data);
        });
    }catch(e){
        console.log(e);
    }
    
});

/*
router.post('/admin/trainApp', function (req, res){
    var appId = req.session.appId;
    var appName = req.session.appName;
    var subsKey = req.session.subsKey;
    var versionId;
    var entityArray = [];
    
    for (var i=0; i<saveAppList.length; i++) {
        if (appName === saveAppList[i].name) {
            versionId = saveAppList[i].endpoints.PRODUCTION.versionId;
        }
    }
    var client = new Client();
    
    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': subsKey
        }
    };
    
    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME=@chatName)\n";
    var selectEntityQuery = "SELECT ENTITY_VALUE, ENTITY\n";
    selectEntityQuery += "FROM TBL_COMMON_ENTITY_DEFINE\n";
    selectEntityQuery += "WHERE TRAIN_FLAG = 'N'\n";
    
    var updateEntityQuery = "UPDATE TBL_COMMON_ENTITY_DEFINE\n";
    updateEntityQuery += "SET TRAIN_FLAG = 'Y'\n";
    updateEntityQuery += "WHERE ENTITY_VALUE IN ( @entityValue )";
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let selectAppId = await pool.request()
                .input('chatName', sql.NVarChar, appName)
                .query(selectAppIdQuery);
            var appCount = false;
            var useLuisAppId;
            for(var i = 0 ; i < selectAppId.recordset.length; i++) {
                var luisAppId = selectAppId.recordset[i].APP_ID;
                //luis intent count check
                var intentCountRes = syncClient.get(HOST + '/luis/api/v2.0/apps/' + luisAppId + '/versions/0.1/examples?take=500' , options);
                
                if( !(intentCountRes.body.length >= 280) ) {
                    useLuisAppId = luisAppId;
                    appCount = true;
                }
            }
            
            let dbPool = await appDbConnect.getAppConnection(appSql, req.session.appName, req.session.dbValue);
            if(appCount == false) {
                //create luis app 
                res.send({result:402});
            }else{
                
                let selectEntity = await dbPool.request()
                    .query(selectEntityQuery);
                for(var i = 0 ; i < selectEntity.recordset.length; i++ ) {
                    var entity = selectEntity.recordset[i].ENTITY;
                    var entityValue = selectEntity.recordset[i].ENTITY_VALUE;
                    //luis hierarchicalentities list count check
                    var entityListResult = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/hierarchicalentities?take=500' , options);
                    
                    // luis intent count check
                    var intentCountRes = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/examples?take=500' , options);
                    if( entityListResult.body.length <= 28 && intentCountRes.body.length < 280 ) {
                        var entityId = entityListResult.body[entityListResult.body.length-1].id;
                        // luis hierarchicalentities count check
                        var entityResult = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/hierarchicalentities/'+ entityId , options);
                        
                        if(entityResult.body.children.length < 10) {
                            options.payload = { "name" :  entity };
                            // add hierarchicalentities
                            var entityCreateResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/hierarchicalentities/'+ entityId + '/children', options);
                        } else {
                            options.payload = {
                                "name" : "entity" + (entityListResult.body.length + 1),
                                "children" : [entity]
                            };
                            // add hierarchicalentities list, entity
                            var entityListResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/hierarchicalentities', options);
                        }
                        
                        if( intentCountRes.body.length < 280 ) {
                            //get entity name
                            var getEntityName = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/hierarchicalentities?take=500' , options);
                            var addEntity;
                            for(var k = 0; k < getEntityName.body.length; k++) {
                                for(var j = 0 ; j < getEntityName.body[k].children.length; j++) {
                                    if( getEntityName.body[k].children[j].name == entity ) {
                                        addEntity=getEntityName.body[k].name + "::" + entity;
                                    }
                                }
                            }
                            options.payload = {
                                "text" : entityValue,
                                "intentName" : "intent",
                                "entityLabels" :
                                [
                                    {
                                        "entityName": addEntity,
                                        "startCharIndex" : 0,
                                        "endCharIndex": entityValue.length-1
                                    }
                                ]
                            }
                            // add luis label
                            var addIntentLabel = syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/example' , options);
                        } else {
                            res.send({result:402});
                        }
                        
                    } else {
                        //create luis app 
                        res.send({result:402});
                    }
                    entityArray.push(entityValue);
                }
                var client = new Client();
                client.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/train', options, function (data, response) {
                    var repeat = setInterval(function(){
                        var count = 0;
                        var traninResultGet = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/train' , options);
                        for(var trNum = 0; trNum < traninResultGet.body.length; trNum++) {
                            if(traninResultGet.body[trNum].details.status == "Fail") {
                                res.send({result:400});
                            }
                            if(traninResultGet.body[trNum].details.status == "InProgress") {
                                break;
                            }
                            count++;
                            if(traninResultGet.body.length == count) {
                                var pubOption = {
                                    headers: {
                                        'Ocp-Apim-Subscription-Key': subsKey,
                                        'Content-Type':'application/json'
                                    },
                                    payload:{
                                        'versionId': '0.1',
                                        'isStaging': false,
                                        'region': 'westus'
                                    }
                                }
    
                                var publishResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/publish' , pubOption);
                                clearInterval(repeat);
    
                                res.send({result:200});
                            }
                        }
                    },1000);
              
                });
                var str = "";
    
                for(var entityNum = 0 ; entityNum < entityArray.length; entityNum++) {
                    str += "'" + entityArray[entityNum] + "',";
                }
                str = str.slice(0,-1);
                var updQuery = "UPDATE TBL_COMMON_ENTITY_DEFINE SET TRAIN_FLAG = 'Y' WHERE ENTITY_VALUE IN (" + str + ")";
                if(str != null && str != ""){
                    let updateEntity = await dbPool.request()
                        .input('entityValue', sql.NVarChar, str)
                        .query(updQuery);
                }
                // luis train
                //var trainResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/train' , options);
                //var traninResultGet = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/train' , options);
                // luis publish
            }
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()
});
*/

router.post('/admin/trainApp', function (req, res){
    var appId = req.session.appId;
    var appName = req.session.appName;
    var subsKey = req.session.subsKey;
    var versionId;
    var entityArray = [];
    
    var client = new Client();
    
    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': subsKey
        }
    };

    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME=@chatName)\n";

    (async () => {
        try {

            let pool = await dbConnect.getConnection(sql);
            let selectAppId = await pool.request()
                .input('chatName', sql.NVarChar, appName)
                .query(selectAppIdQuery);

            for(var i = 0 ; i < selectAppId.recordset.length; i++) {
                var luisAppId = selectAppId.recordset[i].APP_ID;
                //luis intent count check
                var intentCountRes = syncClient.get(HOST + '/luis/api/v2.0/apps/' + luisAppId + '/versions/0.1/examples?take=500' , options);
            }


            var repeat = setInterval(function(){
                var trainCount = 0;
                var count = 0;

                var pubOption = {
                    headers: {
                        'Ocp-Apim-Subscription-Key': subsKey,
                        'Content-Type':'application/json'
                    },
                    payload:{
                        'versionId': '0.1',
                        'isStaging': false,
                        'region': 'westus'
                    }
                }

                for(var i = 0; i < selectAppId.recordset.length; i++) {
                    var luisAppId = selectAppId.recordset[i].APP_ID;

                    var traninResultGet = syncClient.get(HOST + '/luis/api/v2.0/apps/' + luisAppId + '/versions/0.1/train' , options);
                    for(var trNum = 0; trNum < traninResultGet.body.length; trNum++) {
                        if(traninResultGet.body[trNum].details.status == "Fail") {
                            res.send({result:400});
                        }
                        if(traninResultGet.body[trNum].details.status == "InProgress") {
                            break;
                        }
                        count++;
                    }

                    trainCount = trainCount + traninResultGet.body.length;

                    console.log("trainResult : " + traninResultGet);
                }

                if(count != 0 && trainCount == count) {
                    for(var i = 0; i < selectAppId.recordset.length; i++) {
                        var luisAppId = selectAppId.recordset[i].APP_ID;
                        var publishResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + luisAppId + '/publish' , pubOption);
                        console.log("publishResult : " + publishResult);
                    }

                    clearInterval(repeat);

                    res.send({result:200});
                }
            },1000);


        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()

});

//luis Train
//Luis app insert
/*
router.post('/admin/trainApp', function (req, res){
    var appId = req.session.appId;
    var appName = req.session.appName;
    var versionId;
    for (var i=0; i<saveAppList.length; i++) {
        if (appName === saveAppList[i].name) {
            versionId = saveAppList[i].endpoints.PRODUCTION.versionId;
        }
    }
    var client = new Client();
    
    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': subKey
        }
    };
    try{
        client.get( HOST + '/luis/api/v2.0/apps/' + appId + '/versions/' + versionId + '/train', options, function (data, response) {
            //console.log(data); // app id값
            var responseData = data;
            var trainResult = {};
            var sucCnt = 0;
            var failCnt = 0;
            //200:성공  400:실패
            // statusId 
            // - 0 : Success
            // - 1 : UpToDate   최신 정보
            // - 2 : InProgress  진행 중
            // - 3 : Fail     -> fail시  failureReason에 이유 넘어옴
            if (response.statusCode == 200) {
                for (var i=0; i< responseData.length; i++) {
                    if (responseData[i].details.statusId === 0 ) {
                        sucCnt++;
                    } else if (responseData[i].details.statusId === 3) {
                        failCnt++;
                    } else {
                        //continue;
                    }
                }
                trainResult.sucCnt = sucCnt;
                trainResult.failCnt = failCnt;
                res.send({result : response.statusCode, resultValue : trainResult});
            } else if (response.statusCode == 400) {
                res.send({result : response.statusCode, message : data.error.message});
            } else { //401
                res.send({result : response.statusCode, message : response.message});
            }
        });
    }catch(e){
        console.log(e);
    }
});
*/

router.post('/ajax1', function (req, res) {
    console.log("동기동기 비동기");
    var responseData = {'result': 'ok', 'title' : 'ajax테스트 게시물', 'writer' : req.session.sid, 'date': '2017-12-28'};
    res.json(responseData);
});

router.post('/ajax2', function(req, res, next) {

    console.log('POST 방식으로 서버 호출됨');
    //view에 있는 data 에서 던진 값을 받아서

    var msg = req.body.msg;
    msg = '[에코]' + msg;

    //json 형식으로 보내 준다.
    res.send({result:true, msg:msg});

});

router.get('/index/lang', function (req, res) {
    if(req.cookies.i18n == "en") {
        res.cookie('i18n', 'ko', { maxAge: 24000 * 60 * 60 , httpOnly: true });
    } else if (req.cookies.i18n == "ko") {
        res.cookie('i18n', 'en', { maxAge: 24000 * 60 * 60, httpOnly: true });
    }

    res.redirect('back');
});

router.post('/jsLang', function (req, res) {

    if(res.locals.languageNow == "en") {
        res.send({ lang: res.locals.en});
    } else if (res.locals.languageNow == "ko") {
        res.send({lang: res.locals.ko});
    }
});


function pad(n, width) {
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
}


module.exports = router;