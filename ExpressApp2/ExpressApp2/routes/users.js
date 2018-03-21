'use strict';
var express = require('express');
var crypto = require('crypto');
var sql = require('mssql');
var Client = require('node-rest-client').Client;
var dbConfig = require('../config/dbConfig').dbConfig;
var dbConnect = require('../config/dbConnect');
var paging = require('../config/paging');
var router = express.Router();

var key = 'taiho123!@#$';
var initPW = '1234';
/*기본 암호화 pw */
const cipher = crypto.createCipher('aes192', key);
let basePW = cipher.update(initPW, 'utf8', 'base64'); 
basePW = cipher.final('base64'); 

const HOST = 'https://westus.api.cognitive.microsoft.com'; // Luis api host
/* GET users listing. */
router.get('/', function (req, res) {
    res.send('respond with a resource');
});

router.post('/login', function (req, res) {  
    //req.session.sid = req.body.mLoginId;

    var userId = req.body.mLoginId;
    var userPw = req.body.mLoginPass;

    //암호화
    /*
    var cipher = crypto.createCipher('aes192', key);
    cipher.update('1234', 'utf8', 'base64');
    var cipheredOutput = cipher.final('base64');
    console.log(cipheredOutput);
    */
    dbConnect.getConnection(sql).then(pool => {
    //new sql.ConnectionPool(dbConfig).connect().then(pool => {
        return pool.request().query("SELECT USER_ID, SCRT_NUM FROM TB_USER_M WHERE USER_ID = '" + userId +"'")
        }).then(result => {
            let rows = result.recordset;
            console.log(rows);

            if(rows.length > 0 && rows[0].USER_ID != null && rows[0].USER_ID == userId) {
                //암호화 해제
                var decipher = crypto.createDecipher('aes192', key);
                decipher.update(rows[0].SCRT_NUM, 'base64', 'utf8');
                var decipheredOutput = decipher.final('utf8');

                console.log(decipheredOutput);

                if(decipheredOutput == userPw) {
                    req.session.sid = req.body.mLoginId;

                    //subscription key 조회 start-----
                    dbConnect.getConnection(sql).then(pool => { 
                        return pool.request().query( "SELECT CNF_TYPE, CNF_NM, CNF_VALUE, ORDER_NO FROM TBL_CHATBOT_CONF WHERE CNF_TYPE = 'LUIS_SUBSCRIPTION'; " ) 
                    }).then(result => {
                        let subsList = result.recordset;
                        req.session.subsKeyList = subsList;

                        if (subsList.findIndex(x => x.CNF_NM === req.session.sid) !== -1) {
                            req.session.subsKey = subsList[subsList.findIndex(x => x.CNF_NM === req.session.sid)].CNF_VALUE;
                        } else {
                            req.session.subsKey = subsList[subsList.findIndex(x => x.CNF_NM === 'admin')].CNF_VALUE;
                        }
                        
                        req.session.save(function(){
                            res.redirect("/");
                        });
                    }).catch(err => {
                        console.log(err);
                        sql.close();
                    });
                    //subscription key 조회 end-----


                    
                } else {
                    res.send('<script>alert("비밀번호가 일치하지 않습니다.");location.href="/";</script>');
                }
            } else {
                res.send('<script>alert("아이디를 찾을수 없습니다.");location.href="/";</script>');
            }
          sql.close();
        }).catch(err => {
          console.log(err);
          sql.close();
        });

});

router.get('/logout', function (req, res) { 
    
    req.session.destroy(function (err) { 
        if (err) { 
            console.log(err); 
        } else { 
            res.clearCookie('sid');
            res.redirect('/'); 
        }
    });
    

    /*
    delete req.session.sid;
    delete req.session.appName;
    delete req.session.appId;
    delete req.session.leftList;
    delete req.session.subKey;

    req.session.save(function(){
		res.redirect('/');
	});
    */
	
});

router.get('/userMng', function (req, res) {  
    res.render('userMng');
});

router.post('/selectUserList', function (req, res) {

    let sortIdx = checkNull(req.body.sort, "USER_ID") + " " + checkNull(req.body.order, "ASC");
    let pageSize = checkNull(req.body.rows, 10);
    let currentPageNo = checkNull(req.body.page, 1);
    
    let searchName = checkNull(req.body.searchName, null);
    let searchId = checkNull(req.body.searchId, null);

    (async () => {
        try {
         
            var QueryStr =  "SELECT TBZ.* ,(TOT_CNT - SEQ + 1) AS NO \n" +
                            "  FROM (SELECT TBY.* \n" +
                            "          FROM (SELECT ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") AS SEQ, \n" +
                            "                       COUNT('1') OVER(PARTITION BY '1') AS TOT_CNT, \n" +
                            "                       CEILING(ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") / CONVERT( NUMERIC, " + pageSize + " ) ) PAGEIDX, \n" +
                            "                       TBX.* \n" +
                            "                  FROM ( \n" +
                            "                         SELECT \n" +
                            "                              A.EMP_NUM      AS EMP_NUM \n" +
                            "                            , ISNULL(A.USER_ID, ' ')      AS USER_ID \n" +
                            //"                            , ISNULL(A.SCRT_NUM, ' ')     AS SCRT_NUM " +
                            "                            , ISNULL(A.EMP_NM, ' ')       AS EMP_NM \n" +
                            "                            , ISNULL(A.EMP_ENGNM, ' ')    AS EMP_ENGNM \n" +
                            "                            , ISNULL(A.EMAIL, ' ')        AS EMAIL \n" +
                            "                            , ISNULL(A.M_P_NUM_1, ' ')    AS M_P_NUM_1 \n" +
                            "                            , ISNULL(A.M_P_NUM_2, ' ')    AS M_P_NUM_2 \n" +
                            "                            , ISNULL(A.M_P_NUM_3, ' ')    AS M_P_NUM_3 \n" +
                            "                            , ISNULL(A.USE_YN, ' ')       AS USE_YN \n" +
                            "                            , ISNULL(CONVERT(NVARCHAR(10), A.REG_DT, 120), ' ') AS REG_DT \n" +
                            "                            , ISNULL(A.REG_ID, ' ')       AS REG_ID " +
                            "                            , ISNULL(CONVERT(NVARCHAR(10), A.MOD_DT, 120), ' ') AS MOD_DT \n" +
                            "                            , ISNULL(A.MOD_ID, ' ')       AS MOD_ID \n" +
                            "                            , ISNULL(A.LOGIN_FAIL_CNT, 0)      AS LOGIN_FAIL_CNT \n" +
                            "                            , ISNULL(CONVERT(NVARCHAR, A.LAST_LOGIN_DT, 120), ' ')  AS LAST_LOGIN_DT \n" +
                            "                            , ISNULL(CONVERT(NVARCHAR, A.LOGIN_FAIL_DT, 120), ' ')  AS LOGIN_FAIL_DT \n" +
                            "                         FROM TB_USER_M A \n" +
                            "                         WHERE 1 = 1 \n" +
                            "					      AND A.USE_YN = 'Y' \n"; 

            if (searchName) {
                QueryStr += "					      AND A.EMP_NM like '%" + searchName + "%' \n";
            }
            if (searchId) {
                QueryStr += "					      AND A.USER_ID like '%" + searchId + "%' \n";
            }
            QueryStr +=     "                       ) TBX \n" +
                            "               ) TBY \n" +
                            "       ) TBZ \n" +
                            " WHERE PAGEIDX = " + currentPageNo + " \n" +
                            "ORDER BY " + sortIdx + " \n";
            
            
            let pool = await dbConnect.getConnection(sql);
            let result1 = await pool.request().query(QueryStr);

            let rows = result1.recordset;

            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
/*
                item.USER_ID = rows[i].USER_ID;
                item.USER_ID_HIDDEN = rows[i].USER_ID_HIDDEN;
                item.SCRT_NUM = rows[i].SCRT_NUM;
                item.USE_YN = rows[i].USE_YN;
                item.REG_ID = rows[i].REG_ID;
                item.REG_DT = rows[i].REG_DT;
                item.MOD_ID = rows[i].MOD_ID;
                item.MOD_DT = rows[i].MOD_DT;
                item.TOT_CNT = rows[i].TOT_CNT;
                item.EMAIL = rows[i].EMAIL;
                item.M_P_NUM_1 = rows[i].M_P_NUM_1;
                item.M_P_NUM_2 = rows[i].M_P_NUM_2;
                item.M_P_NUM_3 = rows[i].M_P_NUM_3;
*/
                item = rows[i];
                

                recordList.push(item);
            }


            if(rows.length > 0){

                var totCnt = 0;
                if (recordList.length > 0)
                    totCnt = checkNull(recordList[0].TOT_CNT, 0);
                var getTotalPageCount = Math.floor((totCnt - 1) / checkNull(rows[0].TOT_CNT, 10) + 1);


                res.send({
                    records : recordList.length,
                    total : getTotalPageCount,
                    pageList : paging.pagination(currentPageNo,rows[0].TOT_CNT), //page : checkNull(currentPageNo, 1),
                    rows : recordList
                });

            }else{
                res.send({list : result});
            }
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })


});

function checkNull(val, newVal) {
    if (val === "" || typeof val === "undefined" || val === "0") {
        return newVal;
    } else {
        return val;
    }
}

router.post('/saveUserInfo', function (req, res) {  
    var userArr = JSON.parse(req.body.saveArr);
    var saveStr = "";
    var updateStr = "";
    var deleteStr = "";

    

    for (var i=0; i<userArr.length; i++) {
        if (userArr[i].statusFlag === 'NEW') {
            saveStr += "INSERT INTO TB_USER_M (EMP_NUM, USER_ID, SCRT_NUM, EMP_NM, USE_YN) " + 
                       "VALUES ( (SELECT MAX(EMP_NUM)+1 FROM TB_USER_M), ";
            saveStr += " '" + userArr[i].USER_ID  + "', '" + basePW  + "', '" + userArr[i].EMP_NM  + "', 'Y'); ";
        } else if (userArr[i].statusFlag === 'EDIT') {
            updateStr += "UPDATE TB_USER_M SET EMP_NM = '" + userArr[i].EMP_NM  + "' WHERE USER_ID = '" + userArr[i].USER_ID + "'; ";
        } else { //DEL
            deleteStr += "UPDATE TB_USER_M SET USE_YN = 'N' WHERE USER_ID = '" + userArr[i].USER_ID + "' AND EMP_NM = '" + userArr[i].EMP_NM + "'; ";
        }
    }

    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            if (saveStr !== "") {
                let insertUser = await pool.request().query(saveStr);
            }
            if (updateStr !== "") {
                let updateUser = await pool.request().query(updateStr);
            }
            if (deleteStr !== "") {
                let deleteUser = await pool.request().query(deleteStr);
            }

            res.send({status:200 , message:'Save Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Save Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
});
router.post('/inItPassword', function (req, res) {

    var userId = req.body.paramUserId;
    var initStr = "UPDATE TB_USER_M SET SCRT_NUM = '" + basePW  + "' WHERE USER_ID = '" + userId + "'; ";
    //basePW
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let initPwStr = await pool.request().query(initStr);

            res.send({status:200 , message:'Init Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Init Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })

});

//
router.get('/userAuthMng', function (req, res) {  
    res.render('userAuthMng');
});

router.post('/selectUserAppList', function (req, res) {
    
    let userId = checkNull(req.body.userId, '');
    var currentPage = checkNull(req.body.currentPage, 1);
    var currentPageUser = checkNull(req.body.currentPageUser, 1);
    var selectAppListStr = "SELECT tbp.* from \n" +
                            " (SELECT ROW_NUMBER() OVER(ORDER BY CHATBOT_NAME DESC) AS NUM, \n" +
                            "         COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                            "         CEILING((ROW_NUMBER() OVER(ORDER BY CHATBOT_NAME DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                            "         CHATBOT_NUM, CHATBOT_NAME, CULTURE, DESCRIPTION, APP_COLOR \n" +
                           "          FROM TBL_CHATBOT_APP ) tbp \n" +
                           " WHERE 1=1 \n" +
                           "   AND PAGEIDX = " + currentPage + "; \n";

    var UserAppListStr = "SELECT tbp.* from \n" +
                         "   (SELECT ROW_NUMBER() OVER(ORDER BY USER_ID DESC) AS NUM, \n" +
                         "           COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                         "           CEILING((ROW_NUMBER() OVER(ORDER BY USER_ID DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                        "            APP_ID \n" +
                        "       FROM TBL_USER_RELATION_APP \n" +
                        "      WHERE 1=1 \n" +
                        "        AND USER_ID = '" + userId + "') tbp  \n" + 
                        " WHERE 1=1;  \n";
                        //"   AND PAGEIDX = " + currentPage + "; \n";                  
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let appList = await pool.request().query(selectAppListStr);
            let rows = appList.recordset;

            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                item = rows[i];
                recordList.push(item);
            }

            let userAppList = await pool.request().query(UserAppListStr);
            let rows2 = userAppList.recordset;

            var checkedApp = [];
            for(var i = 0; i < rows2.length; i++){
                for (var j=0; j < recordList.length; j++) {
                    if (Number(rows2[i].APP_ID) === recordList[j].CHATBOT_NUM) {
                        var item = {};
                        item = rows2[i];
                        checkedApp.push(item);
                        break;
                    }
                }
                
            }

            res.send({
                records : recordList.length,
                rows : recordList,
                checkedApp : checkedApp,
                pageList : paging.pagination(currentPage,rows[0].TOTCNT)
            });
            
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
})

router.post('/updateUserAppList', function (req, res) {
    let userId = req.body.userId;
    let saveData = JSON.parse(checkNull(req.body.saveData, ''));
    let removeData = JSON.parse(checkNull(req.body.removeData, ''));
    var saveDataStr = "";
    var removeDataStr = "";

    for (var i=0; i<saveData.length; i++) {
        saveDataStr += "INSERT INTO TBL_USER_RELATION_APP(USER_ID, APP_ID, CHAT_ID) " +
                    "     VALUES ('" + userId + "', " + saveData[i] + ", " + saveData[i] + "); \n";    
    }
    
    for (var i=0; i<removeData.length; i++) {
        removeDataStr += "DELETE FROM TBL_USER_RELATION_APP \n" +
                    "      WHERE 1=1 \n" +
                    "        AND CHAT_ID = " + removeData[i].APP_ID + " \n" +
                    "        AND USER_ID = '" + userId + "'; \n";     
    }
                        
                   
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            if (saveData.length > 0) {
                let appList = await pool.request().query(saveDataStr);
            }
            
            if (removeData.length > 0) {
                let userAppList = await pool.request().query(removeDataStr);
            }

            res.send({status:200 , message:'Update Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Update Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
    
})

router.get('/chatBotMng', function (req, res) {  
    res.render('chatBotMng');
});

router.post('/selecChatList', function (req, res) {

    let pageSize = checkNull(req.body.rows, 10);
    let currentPageNo = checkNull(req.body.page, 1);
    
    let searchName = checkNull(req.body.searchName, null);
    let sortIdx = "CHATBOT_NAME";
    (async () => {
        try {
         
            var QueryStr =  "SELECT TBZ.* ,(TOT_CNT - SEQ + 1) AS NO \n" +
                            "  FROM (SELECT TBY.* \n" +
                            "          FROM (SELECT ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") AS SEQ, \n" +
                            "                       COUNT('1') OVER(PARTITION BY '1') AS TOT_CNT, \n" +
                            "                       CEILING(ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") / CONVERT( NUMERIC, " + pageSize + " ) ) PAGEIDX, \n" +
                            "                       TBX.* \n" +
                            "                  FROM ( \n" +
                            "                         SELECT \n" +
                            "                              A.CHATBOT_NUM      AS CHATBOT_NUM, \n" +
                            "                              A.CHATBOT_NAME      AS CHATBOT_NAME, \n" +
                            "                              A.CULTURE      AS CULTURE, \n" +
                            "                              A.DESCRIPTION      AS DESCRIPTION, \n" +
                            "                              A.APP_COLOR      AS APP_COLOR \n" +
                            "                         FROM TBL_CHATBOT_APP A \n" +
                            "                         WHERE 1 = 1 \n" ;

            if (searchName) {
                QueryStr += "					      AND A.CHATBOT_NAME like '%" + searchName + "%' \n";
            }
            QueryStr +=     "                       ) TBX \n" +
                            "               ) TBY \n" +
                            "       ) TBZ \n" +
                            " WHERE PAGEIDX = " + currentPageNo + " \n";
            
            
            let pool = await dbConnect.getConnection(sql);
            let result1 = await pool.request().query(QueryStr);

            let rows = result1.recordset;

            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                item = rows[i];
                

                recordList.push(item);
            }


            if(rows.length > 0){

                var totCnt = 0;
                if (recordList.length > 0)
                    totCnt = checkNull(recordList[0].TOT_CNT, 0);
                var getTotalPageCount = Math.floor((totCnt - 1) / checkNull(rows[0].TOT_CNT, 10) + 1);


                res.send({
                    records : recordList.length,
                    total : getTotalPageCount,
                    pageList : paging.pagination(currentPageNo,rows[0].TOT_CNT), //page : checkNull(currentPageNo, 1),
                    rows : recordList
                });

            }else{
                res.send({list : result});
            }
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })


});

router.post('/selectChatAppList', function (req, res) {
    
    let chatId = checkNull(req.body.clicChatId, '');
    var currentPage = checkNull(req.body.currentPage, 1);
    var currentPageUser = checkNull(req.body.currentPageUser, 1);
    var selectAppListStr = "SELECT tbp.* from \n" +
                            " (SELECT ROW_NUMBER() OVER(ORDER BY APP_NAME DESC) AS NUM, \n" +
                            "         COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                            "         CEILING((ROW_NUMBER() OVER(ORDER BY APP_NAME DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                            "         APP_NAME, APP_ID,  LEFT(OWNER_EMAIL, CHARINDEX('@', OWNER_EMAIL)-1) OWNER_EMAIL, CHATBOT_ID \n" +
                           "          FROM TBL_LUIS_APP ) tbp \n" +
                           " WHERE 1=1 \n" +
                           "   AND PAGEIDX = " + currentPage + "; \n";

    var UserAppListStr = " SELECT  CHAT_ID, APP_ID \n" +
                         "   FROM TBL_CHAT_RELATION_APP  \n" +
                         "  WHERE 1=1  \n"  +
                         "    AND CHAT_ID = " + chatId + "  \n";          
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let appList = await pool.request().query(selectAppListStr);
            let rows = appList.recordset;

            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                item = rows[i];
                recordList.push(item);
            }

            let userAppList = await pool.request().query(UserAppListStr);
            let rows2 = userAppList.recordset;

            var checkedApp = [];
            for(var i = 0; i < rows2.length; i++){
                for (var j=0; j < recordList.length; j++) {
                    if (rows2[i].APP_ID.trim() === recordList[j].APP_ID.trim()) {
                        var item = {};
                        rows2[i].APP_ID = rows2[i].APP_ID.trim();
                        item = rows2[i];
                        checkedApp.push(item);
                        break;
                    }
                }
                
            }

            res.send({
                records : recordList.length,
                rows : recordList,
                checkedApp : checkedApp,
                pageList : paging.pagination(currentPage,rows[0].TOTCNT)
            });
            
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
})

router.post('/updateChatAppList', function (req, res) {
    let chatId = req.body.chatId.trim();
    let saveData = JSON.parse(checkNull(req.body.saveData, ''));
    let removeData = JSON.parse(checkNull(req.body.removeData, ''));
    var saveDataStr = "";
    var removeDataStr = "";

    for (var i=0; i<saveData.length; i++) {
        saveDataStr += "INSERT INTO TBL_CHAT_RELATION_APP(CHAT_ID, APP_ID) " +
                    "     VALUES (" + chatId + ", '" + saveData[i] + "'); \n";    
        
        //saveDataStr += "UPDATE TBL_LUIS_APP SET CHATBOT_ID = " + chatId + " WHERE APP_ID = '" + saveData[i] + "'; \n";  
    }
    
    for (var i=0; i<removeData.length; i++) {
        removeDataStr += "DELETE FROM TBL_CHAT_RELATION_APP \n" +
                    "      WHERE 1=1 \n" +
                    "        AND CHAT_ID = " + chatId + " \n" +
                    "        AND APP_ID = '" + removeData[i].APP_ID.trim() + "'; \n ";     
        
        //removeDataStr += " UPDATE TBL_LUIS_APP SET CHATBOT_ID = NULL WHERE APP_ID = '" + removeData[i].APP_ID.trim() + "'; \n" ;
    }
                        
                   
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            if (saveData.length > 0) {
                let appList = await pool.request().query(saveDataStr);
            }
            
            if (removeData.length > 0) {
                let userAppList = await pool.request().query(removeDataStr);
            }

            res.send({status:200 , message:'Update Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Update Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
    
})

router.get('/apiSetting', function (req, res) {
    res.render('apiSetting');
})

router.post('/selectApiList', function (req, res) {
    res.locals.selMenu = req.session.selMenu = 'm1';
    
    let sortIdx = checkNull(req.body.sort, "USER_ID") + " " + checkNull(req.body.order, "ASC");
    let pageSize = checkNull(req.body.rows, 10);
    let currentPageNo = checkNull(req.body.page, 1);
    
    let searchId = checkNull(req.body.searchId, null);

    var selectAppListStr = "SELECT tbp.* from \n" +
                            " (SELECT ROW_NUMBER() OVER(ORDER BY API_ID DESC) AS NUM, \n" +
                            "         COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                            "         CEILING((ROW_NUMBER() OVER(ORDER BY API_ID DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                            "         API_SEQ, API_ID AS API_ID_HIDDEN, API_ID,  API_URL, API_DESC, USE_YN \n" +
                            "     FROM TBL_URL ) tbp \n" +
                            " WHERE 1=1 \n" +
                            " AND   USE_YN='Y' \n";
    if (searchId) {
        selectAppListStr +="   AND API_ID like '%" + searchId + "%' \n";
    }          
    selectAppListStr +=  "ORDER BY API_SEQ ASC, API_ID ASC; \n";
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let appList = await pool.request().query(selectAppListStr);
            let rows = appList.recordset;


            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                item = rows[i];
                recordList.push(item);
            }

            res.send({
                records : recordList.length,
                rows : recordList,
                pageList : paging.pagination(currentPageNo,rows[0].TOTCNT)
            });
            
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
})

router.post('/saveApiInfo', function(req, res){
    var apiArr = JSON.parse(req.body.saveArr);
    var saveStr = "";
    var updateStr = "";
    var deleteStr = "";

    for (var i=0; i<apiArr.length; i++) {
        if (apiArr[i].statusFlag === 'NEW') {
            saveStr += "INSERT INTO TBL_URL (API_ID, API_URL, API_DESC) ";
            saveStr += "VALUES ('" + apiArr[i].API_ID  + "', '" + apiArr[i].API_URL  + "', '" + apiArr[i].API_DESC  + "'); ";
        } else if (apiArr[i].statusFlag === 'EDIT') {
            updateStr += "UPDATE TBL_URL SET API_ID = '" + apiArr[i].API_ID  + "', "
                                        +  " API_URL = '" + apiArr[i].API_URL  + "', "
                                        +  " API_DESC = '" + apiArr[i].API_DESC   + "' "
                      +  "WHERE API_SEQ = '" + apiArr[i].API_SEQ + "'; ";
        } else { //DEL
            deleteStr += "UPDATE TBL_URL SET USE_YN = 'N' WHERE API_SEQ = '" + apiArr[i].API_SEQ + "'; ";
        }
    }

    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            if (saveStr !== "") {
                let insertUser = await pool.request().query(saveStr);
            }
            if (updateStr !== "") {
                let updateUser = await pool.request().query(updateStr);
            }
            if (deleteStr !== "") {
                let deleteUser = await pool.request().query(deleteStr);
            }

            res.send({status:200 , message:'Save Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Save Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
});


router.get('/addApp', function (req, res) {
    res.render('addApp');
});

router.post('/selecChatList', function (req, res) {

    var selectAppListStr =  " SELECT CHATBOT_NUM, CHATBOT_NAME, CULTURE, DESCRIPTION, APP_COLOR \n" + 
                            " FROM TBL_CHATBOT_APP \n" +
                            " WHERE 1=1 \n" +
                            " ORDER BY CHATBOT_NAME DESC, CULTURE DESC; \n";
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let appList = await pool.request().query(selectAppListStr);
            let rows = appList.recordset;


            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                item = rows[i];
                recordList.push(item);
            }

            res.send({
                rows : recordList
            });
            
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
})

router.post('/addApp', function (req, res) {

    var chatNum = req.body.selApp;
    var chatName = req.body.selAppName;
    var appDes = checkNull(req.body.appDes, ' ');
    var getApplist = "SELECT APP_NAME, CULTURE, SUBSC_KEY FROM TBL_LUIS_APP WHERE CHATBOT_ID = " + chatNum + ";";
    
    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            let rows = await pool.request().query(getApplist);

            var appNames = rows.recordset;
            var appName = appNames[0].APP_NAME.split("_")[0] + "_" + appNames[0].APP_NAME.split("_")[1] + "_" + pad(appNames.length+1, 2);
            var appCulture = appNames[0].CULTURE;

            var selSubKey = appNames[0].SUBSC_KEY;

            var client = new Client();
            
            var options = {
                headers: {
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key': selSubKey
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
                    
                    if(response.statusCode == 201){ // 등록 성공

                        var createAppId = data;

                        var client = new Client();
                            var options = {
                                headers: {
                                    'Ocp-Apim-Subscription-Key': selSubKey//subKey
                                }
                            };

                            client.get( HOST + '/luis/api/v2.0/apps/' + createAppId, options, function (data, response) {

                                var appInfo = data;
                                var appStr = "";
                                appStr += "INSERT INTO TBL_LUIS_APP (APP_NUM, SUBSC_KEY, APP_ID, VERSION, APP_NAME, OWNER_EMAIL, REG_DT, CULTURE, DESCRIPTION) \n";
                                appStr += "VALUES ((SELECT isNULL(MAX(APP_NUM),0) FROM TBL_LUIS_APP)+1, '" + selSubKey + "', '" + appInfo.id + "', \n" +
                                            " '" + appInfo.activeVersion + "', '" + appInfo.name + "', '" + appInfo.ownerEmail + "', \n" +
                                            " convert(VARCHAR(33), '" + appInfo.createdDateTime + "', 126), '" + appInfo.culture + "', '" + appInfo.description + "'); \n";

                                appStr += "INSERT INTO TBL_CHAT_RELATION_APP(CHAT_ID, APP_ID) \n";
                                appStr += "VALUES(" + chatNum + ", '" + appInfo.id + "'); \n";

                                dbConnect.getConnection(sql).then(pool => {
                                    //new sql.ConnectionPool(dbConfig).connect().then(pool => {
                                    return pool.request().query(appStr)
                                }).then(result => {
                                    let rows = result.recordset;

                                    var insertQry = "INSERT INTO TBL_CHATBOT_CONF (CNF_TYPE, CNF_NM, CNF_VALUE, ORDER_NO) \n" +
                                                    "VALUES ('LUIS_APP_ID', '" + appInfo.name + "', '" + appInfo.id + "', (SELECT MAX(ORDER_NO)+1 FROM TBL_CHATBOT_CONF WHERE CNF_TYPE='LUIS_APP_ID')); "
                                    dbConnect.getAppConnection(sql, chatName, req.session.dbValue).then(pool => {
                                        //new sql.ConnectionPool(dbConfig).connect().then(pool => {
                                        return pool.request().query(insertQry) 
                                    }).then(result => {
                                        let rows = result.recordset;

                                        res.send({ message:'Save Success'});
                                        sql.close();
                                    }).catch(err => {
                                        console.log(err);
                                        sql.close();
                                    });
                                }).catch(err => {
                                    console.log(err);
                                    sql.close();
                                });
                                
                                
                                //res.send({ resultId:response.statusCode, createAppId:createAppId,  message:'Save Success'});
                        });

                        
                        
                    }else{
                        res.send({ message:'Save failed'});
                    }
                });
            }catch(e){
                console.log(e);
            }
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Save Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
})


router.post('/getAppSelValues', function (req, res) {


    (async () => {
        try {
            let pool = await dbConnect.getConnection(sql);
            if (saveStr !== "") {
                let insertUser = await pool.request().query(saveStr);
            }
            if (updateStr !== "") {
                let updateUser = await pool.request().query(updateStr);
            }
            if (deleteStr !== "") {
                let deleteUser = await pool.request().query(deleteStr);
            }

            res.send({status:200 , message:'Save Success'});
            
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'Save Error'});
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
})


function pad(n, width) {
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
}

function checkNull(val, newVal) {
    if (val === "" || typeof val === "undefined" || val === "0") {
        return newVal;
    } else {
        return val;
    }
}

/*
router.post('/', function (req, res) {
    let sortIdx = checkNull(req.body.sort, "USER_ID") + " " + checkNull(req.body.order, "ASC");
    let pageSize = checkNull(req.body.rows, 10);
    let currentPageNo = checkNull(req.body.page, 1);
    
    let searchName = checkNull(req.body.searchName, null);
    let searchId = checkNull(req.body.searchId, null);

    (async () => {
        try {
         
            var QueryStr =  "SELECT TBZ.* ,(TOT_CNT - SEQ + 1) AS NO " +
                            "  FROM (SELECT TBY.* " +
                            "          FROM (SELECT ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") AS SEQ, " +
                            "                       COUNT('1') OVER(PARTITION BY '1') AS TOT_CNT, " +
                            "                       CEILING(ROW_NUMBER() OVER(ORDER BY TBX." + sortIdx + ") / CONVERT( NUMERIC, " + pageSize + " ) ) PAGEIDX, " +
                            "                       TBX.*" +
                            "                  FROM ( " +
                            "                         SELECT " +
                            "                              A.EMP_NUM      AS EMP_NUM " +
                            "                            , A.USER_ID      AS USER_ID_HIDDEN " +
                            "                            , A.USER_ID      AS USER_ID " +
                            "                            , A.SCRT_NUM     AS SCRT_NUM " +
                            "                            , A.EMP_NM       AS EMP_NM " +
                            "                            , A.EMP_ENGNM    AS EMP_ENGNM " +
                            "                            , A.EMAIL        AS EMAIL " +
                            "                            , A.M_P_NUM_1    AS M_P_NUM_1 " +
                            "                            , A.M_P_NUM_2    AS M_P_NUM_2 " +
                            "                            , A.M_P_NUM_3    AS M_P_NUM_3 " +
                            "                            , A.USE_YN       AS USE_YN " +
                            "                            , CONVERT(NVARCHAR(10), A.REG_DT, 120) AS REG_DT " +
                            "                            , A.REG_ID       AS REG_ID " +
                            "                            , CONVERT(NVARCHAR(10), A.MOD_DT, 120) AS MOD_DT " +
                            "                            , A.MOD_ID       AS MOD_ID " +
                            "                            , A.LOGIN_FAIL_CNT      AS LOGIN_FAIL_CNT " +
                            "                            , CONVERT(NVARCHAR, A.LAST_LOGIN_DT, 120)  AS LAST_LOGIN_DT " +
                            "                            , CONVERT(NVARCHAR, A.LOGIN_FAIL_DT, 120)  AS LOGIN_FAIL_DT " +
                            "                         FROM TB_USER_M A " +
                            "                         WHERE 1 = 1 " +
                            "					      AND A.USE_YN = 'Y' "; 

            if (searchName) {
                QueryStr += "					      AND A.EMP_NM like '%" + searchName + "%' ";
            }
            if (searchId) {
                QueryStr += "					      AND A.USER_ID like '%" + searchId + "%' ";
            }
            QueryStr +=     "                       ) TBX " +
                            "               ) TBY " +
                            "       ) TBZ" +
                            " WHERE PAGEIDX = " + currentPageNo + " " +
                            "ORDER BY " + sortIdx + " ";
            
            
            let pool = await sql.connect(dbConfig)
            let result1 = await pool.request().query(QueryStr);

            let rows = result1.recordset;

            var recordList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                item = rows[i];
                

                recordList.push(item);
            }


            if(rows.length > 0){

                var totCnt = 0;
                if (recordList.length > 0)
                    totCnt = checkNull(recordList[0].TOT_CNT, 0);
                var getTotalPageCount = Math.floor((totCnt - 1) / checkNull(rows[0].TOT_CNT, 10) + 1);


                res.send({
                    records : recordList.length,
                    total : getTotalPageCount,
                    page : checkNull(currentPageNo, 1),
                    rows : recordList
                });

            }else{
                res.send({list : result});
            }
        } catch (err) {
            console.log(err)
            // ... error checks
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        // ... error handler
    })
});
*/


module.exports = router;
