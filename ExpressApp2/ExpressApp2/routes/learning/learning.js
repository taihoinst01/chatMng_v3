'use strict';
var express = require('express');
var Client = require('node-rest-client').Client;
var sql = require('mssql');
var dbConfig = require('../../config/dbConfig');
var dbConnect = require('../../config/dbConnect');
var paging = require('../../config/paging');
var util = require('../../config/util');
var Client = require('node-rest-client').Client;

const syncClient = require('sync-rest-client');
const appDbConnect = require('../../config/appDbConnect');
const appSql = require('mssql');

var router = express.Router();

const HOST = 'https://westus.api.cognitive.microsoft.com'; // Luis api host
/* GET users listing. */
router.get('/', function (req, res) {
    req.session.selMenus = 'ms1';
    req.session.selMenu = 'm3';
    res.redirect('/learning/recommend');
});

router.get('/recommend', function (req, res) {
    req.session.selMenus = 'ms1';
    res.render('recommend', {selMenus: 'ms1'});
});

router.post('/recommend', function (req, res) {
    var selectType = req.body.selectType;
    var currentPage = req.body.currentPage;
    var searchRecommendText = req.body.searchRecommendText;

    (async () => {
        try {
            var entitiesQueryString = ""+
            "SELECT TBZ.* \n"+
            "  FROM ( \n"+
            "        SELECT TBY.*  \n"+
            "          FROM ( \n"+
            "		        SELECT ROW_NUMBER() OVER(ORDER BY TBX.SEQ DESC) AS NUM,  \n"+
            "                       COUNT('1') OVER(PARTITION BY '1') AS TOTCNT,  \n"+
            "                       CEILING((ROW_NUMBER() OVER(ORDER BY TBX.SEQ DESC) )/ convert(numeric ,10)) PAGEIDX,  \n"+
            "                       TBX.*  \n"+
            "                 FROM (  \n"+
            "                        SELECT SEQ,QUERY,CONVERT(CHAR(19), UPD_DT, 20) AS UPD_DT,(SELECT RESULT FROM dbo.FN_ENTITY_ORDERBY_ADD(QUERY)) AS ENTITIES, TBH.QUERY_KR \n"+
            "                          FROM TBL_QUERY_ANALYSIS_RESULT, ( \n"+
            "						                                     SELECT CUSTOMER_COMMENT_KR AS QUERY_KR \n"+
            "						                                       FROM TBL_HISTORY_QUERY \n"+
            "						                                      GROUP BY CUSTOMER_COMMENT_KR ) TBH \n"+
            "                         WHERE RESULT NOT IN ('H')  \n"+
            "                           AND TRAIN_FLAG = 'N'  \n"+
            "                           AND QUERY = dbo.fn_replace_regex(TBH.QUERY_KR)  \n";

            if(selectType == 'yesterday'){
                entitiesQueryString += " AND (CONVERT(CHAR(10), UPD_DT, 23)) like '%'+(select CONVERT(CHAR(10), (select dateadd(day,-1,getdate())), 23)) + '%'";
            }else if(selectType == 'lastWeek'){
                entitiesQueryString += " AND (CONVERT(CHAR(10), UPD_DT, 23)) >= (SELECT CONVERT(CHAR(10), (DATEADD(wk, DATEDIFF(d, 0, getdate()) / 7 - 1, -1)), 23))";
                entitiesQueryString += " AND (CONVERT(CHAR(10), UPD_DT, 23)) <= (SELECT CONVERT(CHAR(10), (DATEADD(wk, DATEDIFF(d, 0, getdate()) / 7 - 1, 5)), 23))";
            }else if(selectType == 'lastMonth'){
                entitiesQueryString += "  AND CONVERT(CHAR(10), UPD_DT, 23)  BETWEEN CONVERT(CHAR(10),dateadd(month,-1,getdate()), 23) and CONVERT(CHAR(10), getdate(), 23) ";
            }else{
            }
            
            if(searchRecommendText) {
                
                entitiesQueryString += " AND QUERY LIKE '%" + searchRecommendText + "%' "; 
            }

            entitiesQueryString += ""+
            "                       ) TBX \n"+
            "			   ) TBY \n"+
            "	     ) TBZ \n"+
            " WHERE 1=1  \n"+
            "   AND PAGEIDX = @currentPage  \n" +
            " ORDER BY NUM \n";

            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request()
                .input('currentPage', sql.Int, currentPage)
                .query(entitiesQueryString)
            let rows = result1.recordset;

            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};
                var query = rows[i].QUERY_KR;
                var seq = rows[i].SEQ;
                var entities = rows[i].ENTITIES;
                var updDt = rows[i].UPD_DT;
                var entityArr = rows[i].ENTITIES.split(',');
                var luisQueryString = "";

                item.QUERY = query;
                item.UPD_DT = updDt;
                item.SEQ = seq;
                item.ENTITIES = entities;
                if(entityArr[0] == ""){
                    item.intentList = [];
                }else{
                    for(var j = 0; j < entityArr.length; j++) {
                        if(j == 0){
                            luisQueryString += "SELECT DISTINCT LUIS_INTENT FROM TBL_DLG_RELATION_LUIS WHERE LUIS_ENTITIES LIKE '%" + entityArr[j] + "%'"
                        }else{
                            luisQueryString += "OR LUIS_ENTITIES LIKE '%" + entityArr[j] + "%'";
                        }
                    }
                    let luisIntentList = await pool.request()
                    .query(luisQueryString)
                    item.intentList = luisIntentList.recordset
                }
                result.push(item);
            }

            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT)});
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

router.get('/utterances', function (req, res) {
	var utterance = req.query.utterance;

    req.session.selMenus = 'ms2';
    res.render('utterances', {
        selMenus: req.session.selMenus,
		utterance: utterance
    } );
});


router.post('/getLuisInfo', function (req, res) {

    (async () => {
        try {

            var searchInfo = req.body.searchInfo;
            
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            if(searchInfo == 'luisIntent') {

                var luisId = req.body.luisId;


                var getLuisIntentQuery = " SELECT DISTINCT LUIS_INTENT FROM TBL_DLG_RELATION_LUIS WHERE LUIS_ID = @luisId";
                                            
                let getLuisIntent_result = await pool.request().input('luisId', sql.NVarChar, luisId).query(getLuisIntentQuery);
                let getLuisIntent_rows = getLuisIntent_result.recordset;
                
                var luisIntentList = [];
                for(var i = 0; i < getLuisIntent_rows.length; i++){
                    var item = {};

                    var luisIntent = getLuisIntent_rows[i].LUIS_INTENT;
                    
                    item.luisIntent = luisIntent; 

                    luisIntentList.push(item);
                }

                res.send({luisIntentList: luisIntentList});
            } else if (searchInfo == 'luisId') {

                var getLuisIdQuery = " SELECT DISTINCT LUIS_ID FROM TBL_DLG_RELATION_LUIS ";
                                        
                let getLuisId_result = await pool.request().query(getLuisIdQuery);
                let getLuisId_rows = getLuisId_result.recordset;
                
                var luisIdList = [];
                for(var i = 0; i < getLuisId_rows.length; i++){
                    var item = {};

                    var luisId = getLuisId_rows[i].LUIS_ID;
                    
                    item.luisId = luisId; 

                    luisIdList.push(item);
                }

                res.send({luisIdList: luisIdList});
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

router.get('/dialog', function (req, res) {

    req.session.selMenus = 'ms3';
    if (!req.session.sid) {
        res.render('dialog');
    } else {

        (async () => {
            try {
                var group_query = "select distinct GroupL from TBL_DLG where GroupL is not null";
                //var group_query = "SELECT DISTINCT GroupL FROM TBL_DLG WHERE GroupL = '" + searchGroupL + "'";
                let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
                let result2 = await pool.request().query(group_query);
                let rows2 = result2.recordset;
                
                var groupList = [];
                for(var i = 0; i < rows2.length; i++){
                    var item2 = {};
    
                    var largeGroup = rows2[i].GroupL;
    
                    //item2.largeGroup = largeGroup;
                    //groupList.push(item2);
                }
                
                res.render('dialog', {
                    selMenus: req.session.selMenus,
                    groupList: rows2
                } );
            } catch (err) {
                console.log(err)
                // ... error checks
            } finally {
                sql.close();
            }
        })()
    }

});

/*
router.post('/', function (req, res) {
    
    
    var currentPage = req.body.currentPage;

    (async () => {
        try {
            var sourceType = req.body.sourceType;
            var groupType = req.body.groupType;
            var dlg_desQueryString = "select tbp.* from " +
                                     "(select ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC) AS NUM, " +
                                     "COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, "  +
                                     "CEILING((ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC))/ convert(numeric ,10)) PAGEIDX, " +
                                     "DLG_DESCRIPTION, DLG_API_DEFINE ,LUIS_ENTITIES, LUIS_INTENT " +
                                     "from TBL_DLG a, TBL_DLG_RELATION_LUIS b " + 
                                     "where a.DLG_ID = b.DLG_ID and LUIS_INTENT like '%" + groupType + "%' " +
                                     "and DLG_API_DEFINE like '%" + sourceType + "%') tbp " +
                                     "WHERE PAGEIDX = @currentPage";
            let pool = await sql.connect(dbConfig);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(dlg_desQueryString);
            let rows = result1.recordset;
            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var description = rows[i].DLG_DESCRIPTION;
                var apidefine = rows[i].DLG_API_DEFINE;
                var luisentties = rows[i].LUIS_ENTITIES;
                var luisentent = rows[i].LUIS_INTENT;

                item.DLG_DESCRIPTION = description;
                item.DLG_API_DEFINE = apidefine;
                item.LUIS_ENTITIES = luisentties;
                item.LUIS_INTENT = luisentent;

                result.push(item);
            }
            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT)});
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
//다이얼로그 대그룹 중그룹 소그룹 셀렉트 박스
router.post('/searchGroup', function (req, res) {
    var searchTxt ='';
    if (req.body.searchTxt != '' && req.body.searchType != '1') {
        searchTxt = req.body.searchTxt;
    }
    var group = req.body.group;
    var groupName = req.body.groupName;
    var groupL = req.body.groupL;

    (async () => {
        try {

            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            var searchGroupQuery;
            if(group == 'searchMedium') {

                searchGroupQuery = "SELECT DISTINCT tbp.GroupM " +
                                   "  FROM (SELECT a.GroupL, a.GroupM, GroupS " +
                                   "          FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b " +
                                   "         WHERE a.DLG_ID = b.DLG_ID   and LUIS_ENTITIES like '%" + searchTxt +  "%' ) tbp " +
                                   " WHERE GroupL = @groupName";

                let result1 = await pool.request().input('groupName', sql.NVarChar, groupName).query(searchGroupQuery);
                let rows = result1.recordset;
                
                var groupList = [];
                for(var i = 0; i < rows.length; i++){
                    var item = {};

                    var mediumGroup = rows[i].GroupM;
                    
                    item.mediumGroup = mediumGroup; 

                    groupList.push(item);
                }

                res.send({groupList: groupList});
            } else if(group == 'searchSmall') {
                searchGroupQuery = "SELECT DISTINCT tbp.GroupS " +
                                   "  FROM (SELECT a.GroupL, a.GroupM, GroupS " +
                                   "          FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b " +
                                   "         WHERE a.DLG_ID = b.DLG_ID   and LUIS_ENTITIES like '%" + searchTxt +  "%' ) tbp " +
                                   " WHERE GroupL = '" + groupL + "' and GroupM = @groupName";
                //searchGroupQuery = "select distinct GroupS from TBL_DLG where GroupL = '" + groupL + "' and GroupM = @groupName";

                let result1 = await pool.request().input('groupName', sql.NVarChar, groupName).query(searchGroupQuery);
                let rows = result1.recordset;
                
                var groupList = [];
                for(var i = 0; i < rows.length; i++){
                    var item = {};
                    var smallGroup = rows[i].GroupS;

                    item.smallGroup = smallGroup; 

                    groupList.push(item);
                }

                res.send({groupList: groupList});
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

//dialog.html 소그룹이 선택 돼었을때 리스트 뿌려주기
router.post('/selectSmallGroup', function (req, res) {
    
    var groupName = req.body.groupName;
    var currentPage = 1;

    if(req.body.currentPage != null) {
        currentPage = req.body.currentPage;
    } 
    (async () => {
        try {

            var selectSmallGroup = "select tbp.* from " +
                                 "(select ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC) AS NUM, " +
                                 "COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, "  +
                                 "CEILING((ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC))/ convert(numeric ,10)) PAGEIDX, " +
                                 "DLG_DESCRIPTION, GroupS, DLG_API_DEFINE ,LUIS_ENTITIES" +
                                 "from TBL_DLG a, TBL_DLG_RELATION_LUIS b " + 
                                 "where a.DLG_ID = b.DLG_ID and GroupS like '%" + groupName + "%' " +
                                 "and DLG_API_DEFINE like '%" + sourceType + "%') tbp " +
                                 "WHERE PAGEIDX = @currentPage";

            //var searchMidGroup = "select * from TBL_DLG where GroupS = @groupName";
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(selectSmallGroup);
            let rows = result1.recordset;
            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var description = rows[i].DLG_DESCRIPTION;
                var apidefine = rows[i].DLG_API_DEFINE;
                var luisentent = rows[i].LUIS_INTENT;
                var smallGroup = rows[i].GroupS;
                
                item.DLG_DESCRIPTION = description;
                item.DLG_API_DEFINE = apidefine;
                item.LUIS_INTENT = luisentent;
                item.GroupS = smallGroup;

                result.push(item);
            }
            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT)});
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

/*
//그룹 테스트
router.post('/searchMidGroup', function (req, res) {
    
    
    var groupName = req.body.groupName;

    (async () => {
        try {
            var searchMidGroup = "select distinct GroupM from TBL_DLG where GroupL = @groupName";
            let pool = await sql.connect(dbConfig);
            let result1 = await pool.request().input('groupName', sql.NVarChar, groupName).query(searchMidGroup);
            let rows = result1.recordset;
            
            var groupList = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var mediumGroup = rows[i].GroupM;

                item.mediumGroup = mediumGroup; 
                console.log("mediumGroup:" + mediumGroup);


                groupList.push(item);
            }


            if(rows.length > 0){
                res.send({groupList: groupList});
            }else{
                res.send({list : groupList});
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

router.post('/searchIptDlg', function (req, res) {
    
    var currentPage = req.body.currentPage;
    var searchText = req.body.searchText;

    (async () => {
        try {
                    
            var dlg_desQueryString = "SELECT tbp.* FROM " +
                                     "  (SELECT ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC) AS NUM, " +
                                     "      a.DLG_ID AS DLG_ID, " +
                                     "      COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, "  +
                                     "      CEILING((ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC))/ convert(numeric ,10)) PAGEIDX, " +
                                     "      DLG_DESCRIPTION, DLG_API_DEFINE ,LUIS_ENTITIES, LUIS_INTENT, GroupS " +
                                     "  FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b where a.DLG_ID = b.DLG_ID ";
                  
                dlg_desQueryString+= "  and LUIS_ENTITIES like '%" + searchText + "%' ";
                dlg_desQueryString += ") tbp WHERE PAGEIDX = @currentPage";
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);//dbConnect.getConnection(sql);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(dlg_desQueryString);
            let rows = result1.recordset;
            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var description = rows[i].DLG_DESCRIPTION;
                var apidefine = rows[i].DLG_API_DEFINE;
                var luisentties = rows[i].LUIS_ENTITIES;
                var luisentent = rows[i].LUIS_INTENT;
                var smallGroup = rows[i].GroupS;
                var dialogueId = rows[i].DLG_ID;
                
                item.DLG_ID = dialogueId;
                item.DLG_DESCRIPTION = description;
                item.DLG_API_DEFINE = apidefine;
                item.LUIS_ENTITIES = luisentties;
                item.LUIS_INTENT = luisentent;
                item.GroupS = smallGroup;

                result.push(item);
            }
            var group_query = "SELECT DISTINCT tbp.GroupL " +
                             "   FROM (SELECT a.GroupL, a.GroupM, GroupS " +
                             "           FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b " +
                             "          WHERE a.DLG_ID = b.DLG_ID   and LUIS_ENTITIES like '%" + searchText +  "%' ) tbp " +
                             "  WHERE GroupL is not null";
            //var group_query = "select distinct GroupL from TBL_DLG where GroupL is not null";
            let result2 = await pool.request().query(group_query);
            let rows2 = result2.recordset;
            
            var groupList = [];
            for(var i = 0; i < rows2.length; i++){
                var item2 = {};

                var largeGroup = rows2[i].GroupL;

                item2.largeGroup = largeGroup;

                groupList.push(item2);
            }

            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT), groupList: groupList});
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

router.post('/dialogs2', function (req, res) {
    
    //var searchTxt = req.body.searchTxt;
    var currentPage = req.body.currentPage;
    var sourceType2 = req.body.sourceType2;
    var searchGroupL = req.body.searchGroupL;
    var searchGroupM = req.body.searchGroupM;
    var searchGroupS = req.body.searchGroupS;

    (async () => {
        try {
                    
            var dlg_desQueryString = "select tbp.* from \n" +
                                     "(select ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC) AS NUM, \n" +
                                     "  a.DLG_ID AS DLG_ID, \n" +
                                     "  COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                                     "  CEILING((ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                                     "  DLG_DESCRIPTION, DLG_API_DEFINE ,LUIS_ENTITIES, LUIS_INTENT, GroupL, GroupM, GroupS \n" +
                                     "  from TBL_DLG a, TBL_DLG_RELATION_LUIS b where a.DLG_ID = b.DLG_ID \n";
                    if (req.body.searchText && !req.body.upperGroupL) {
                        dlg_desQueryString += "AND b.LUIS_ENTITIES like '%" + req.body.searchText + "%' \n";
                    }
                    dlg_desQueryString += "and DLG_API_DEFINE like '%" + sourceType2 + "%' \n";
                    
                    if(req.body.upperGroupL) {
                        dlg_desQueryString += "and GroupL = '" + req.body.upperGroupL + "' \n";
                    }

                    if(req.body.upperGroupM) {
                        dlg_desQueryString += "and GroupM = '" + req.body.upperGroupM + "' \n";
                    }

                    if(req.body.upperGroupS) {
                        dlg_desQueryString += "and GroupS = '" + req.body.upperGroupS + "' \n";
                    }                  
                    if(searchGroupL) {
                        dlg_desQueryString += "and GroupL = '" + searchGroupL + "' \n";
                    }
    
                    if(searchGroupM) {
                        dlg_desQueryString += "and GroupM = '" + searchGroupM + "' \n";
                    }
    
                    if(searchGroupS) {
                        dlg_desQueryString += "and GroupS = '" + searchGroupS + "' \n";
                    } 

                dlg_desQueryString += ") tbp WHERE PAGEIDX = @currentPage \n";

                
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(dlg_desQueryString);
            let rows = result1.recordset;
            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var description = rows[i].DLG_DESCRIPTION;
                var apidefine = rows[i].DLG_API_DEFINE;
                var luisentties = rows[i].LUIS_ENTITIES;
                var luisentent = rows[i].LUIS_INTENT;
                var smallGroup = rows[i].GroupS;
                var dialogueId = rows[i].DLG_ID;
                
                item.DLG_ID = dialogueId;
                item.DLG_DESCRIPTION = description;
                item.DLG_API_DEFINE = apidefine;
                item.LUIS_ENTITIES = luisentties;
                item.LUIS_INTENT = luisentent;
                item.GroupS = smallGroup;

                result.push(item);
            }
            
            var group_query = "select distinct GroupL from TBL_DLG where GroupL is not null";
            //var group_query = "SELECT DISTINCT GroupL FROM TBL_DLG WHERE GroupL = '" + searchGroupL + "'";
            let result2 = await pool.request().query(group_query);
            let rows2 = result2.recordset;
            
            var groupList = [];
            for(var i = 0; i < rows2.length; i++){
                var item2 = {};

                var largeGroup = rows2[i].GroupL;

                item2.largeGroup = largeGroup;

                groupList.push(item2);
            }

            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT), groupList: groupList});
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

});

router.post('/dialogs', function (req, res) {
    var searchTxt = req.body.searchTxt;
    var currentPage = req.body.currentPage;

    (async () => {
        try {
            var sourceType = req.body.sourceType;
            var groupType = req.body.groupType;
            var dlg_desQueryString = "select tbp.* from \n" +
                                     "(select ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC) AS NUM, \n" +
                                     "      a.DLG_ID AS DLG_ID, \n" +
                                     "COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"  +
                                     "CEILING((ROW_NUMBER() OVER(ORDER BY LUIS_ENTITIES DESC))/ convert(numeric ,10)) PAGEIDX, \n" +
                                     "DLG_DESCRIPTION, DLG_API_DEFINE ,LUIS_ENTITIES, LUIS_INTENT, GroupL, GroupM, GroupS \n" +
                                     "FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b \n" + 
                                     "WHERE a.DLG_ID = b.DLG_ID \n";
            if (req.body.searchTxt !== '') {
                dlg_desQueryString += "AND b.LUIS_ENTITIES like '%" + req.body.searchTxt + "%' \n";
            }
            if (req.body.searchGroupL !== '') {
                dlg_desQueryString += "AND a.GroupL = '" + req.body.searchGroupL + "' \n";
            }
            if (req.body.searchGroupM !== '') {
                dlg_desQueryString += "AND a.GroupM = '" + req.body.searchGroupM + "' \n";
            }
            if (req.body.searchGroupS !== '') {
                dlg_desQueryString += "AND a.GroupS = '" + req.body.searchGroupS + "' \n";
            }
        
                                     
/*
            if (groupType != 'View all') {
                dlg_desQueryString += "and GroupS = '" + groupType + "' ";
            }      
*/
            dlg_desQueryString += "AND DLG_API_DEFINE like '%" + sourceType + "%') tbp \n" +
                                      "WHERE PAGEIDX = @currentPage";
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(dlg_desQueryString);
            let rows = result1.recordset;
            
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                
                var description = rows[i].DLG_DESCRIPTION;
                var apidefine = rows[i].DLG_API_DEFINE;
                var luisentties = rows[i].LUIS_ENTITIES;
                var luisentent = rows[i].LUIS_INTENT;
                var smallGroup = rows[i].GroupS;
                var dialogueId = rows[i].DLG_ID;

                item.DLG_ID = dialogueId;
                item.DLG_DESCRIPTION = description;
                item.DLG_API_DEFINE = apidefine;
                item.LUIS_ENTITIES = luisentties;
                item.LUIS_INTENT = luisentent;
                item.GroupS = smallGroup;

                result.push(item);
            }
            var group_query = "SELECT DISTINCT tbp.GroupL " +
                            "   FROM (SELECT a.GroupL, a.GroupM, GroupS " +
                            "           FROM TBL_DLG a, TBL_DLG_RELATION_LUIS b " +
                            "          WHERE a.DLG_ID = b.DLG_ID   and LUIS_ENTITIES like '%" + searchTxt +  "%' ) tbp " +
                            "  WHERE GroupL is not null";
            //var group_query = "select distinct GroupL from TBL_DLG where GroupL is not null";
            let result2 = await pool.request().query(group_query);
            let rows2 = result2.recordset;
            
            var groupList = [];
            for(var i = 0; i < rows2.length; i++){
                var item2 = {};

                var largeGroup = rows2[i].GroupL;

                item2.largeGroup = largeGroup;

                groupList.push(item2);
            }

            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT), groupList: groupList});
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

router.post('/utterInputAjax', function(req, res, next) {
 
    //view에 있는 data 에서 던진 값을 받아서
    var iptUtterance = req.body['iptUtterance[]'];
    var iptUtteranceArr = [];
    var entitiesArr = [];
    var selBoxArr = [];
    var commonEntitiesArr = [];

    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            
            //res.send({result:true, iptUtterance:iptUtterance, entities:entities, selBox:rows2, commonEntities: commonEntities});
            for (var i=0; i< (typeof iptUtterance !=='string'? iptUtterance.length : 1); i++) {
                var iptUtterTmp = (typeof iptUtterance ==='string'? iptUtterance:iptUtterance[i]);
                let result1 = await pool.request()
                    .input('iptUtterance', sql.NVarChar, iptUtterTmp)
                    .query('SELECT RESULT FROM dbo.FN_ENTITY_ORDERBY_ADD(@iptUtterance)')
                
                let rows = result1.recordset;
    
                if(rows[0]['RESULT'] != '') {
                    var entities = rows[0]['RESULT'];
                    var entityArr = entities.split(',');
                    var queryString = "";
                    for(var j = 0; j < entityArr.length; j++) {
                        if(j == 0){
                            queryString += "SELECT DISTINCT LUIS_INTENT FROM TBL_DLG_RELATION_LUIS WHERE LUIS_ENTITIES LIKE '%" + entityArr[j] + "%'"
                        }else{
                            queryString += "OR LUIS_ENTITIES LIKE '%" + entityArr[j] + "%'";
                        }
                    }
    
                    let result2 = await pool.request()
                    .query(queryString)
                    
                    let rows2 = result2.recordset
    
                    var queryString2 = "SELECT ENTITY_VALUE,ENTITY FROM TBL_COMMON_ENTITY_DEFINE WHERE ENTITY IN (";
                    for(var j = 0; j < entityArr.length; j++) {
                        queryString2 += "'";
                        queryString2 += entityArr[j];
                        queryString2 += "'";
                        queryString2 += (j != entityArr.length-1)? "," : "";
                    }
                    queryString2 += ")";
                    let result3 = await pool.request()
                    .query(queryString2)
                    
                    let rows3 = result3.recordset
                    var commonEntities = [];
                    for(var j = 0; j < rows3.length; j++) {
                        // 중복되는 엔티티가 있는 경우 길이가 긴 것이 우선순위를 갖음
                        if(iptUtterTmp.indexOf(rows3[j].ENTITY_VALUE) != -1){
                            // 첫번째 엔티티는 등록
                            var isCommonAdd = false;
                            if(commonEntities.length == 0){
                                isCommonAdd = true;
                            }else{
                                for(var k = 0 ; k < commonEntities.length ; k ++){
                                    var longEntity = '';
                                    var shortEntity = '';
                                    var isAdd = false;
                                    if(rows3[j].ENTITY_VALUE.length >= commonEntities[k].ENTITY_VALUE.length){
                                        longEntity = rows3[j].ENTITY_VALUE;
                                        shortEntity = commonEntities[k].ENTITY_VALUE;
                                        isAdd = true;
                                    }else{
                                        longEntity = commonEntities[k].ENTITY_VALUE;
                                        shortEntity = rows3[j].ENTITY_VALUE;
                                    }
                                    if(longEntity.indexOf(shortEntity) != -1){
                                        if(isAdd){
                                            commonEntities.splice(k,1);
                                            isCommonAdd = true;
                                            break;
                                        }
                                    }else{
                                        isAdd = true;
                                    }
                                    if(isAdd && k == commonEntities.length-1){
                                        isCommonAdd = true;
                                    }
                                }
                            }
                            if(isCommonAdd){
                                var item = {};
                                item.ENTITY_VALUE = rows3[j].ENTITY_VALUE;
                                item.ENTITY = rows3[j].ENTITY;
                                commonEntities.push(item);
                            }
                        }
                    }
                    iptUtteranceArr.push(iptUtterTmp);
                    entitiesArr.push(entities);
                    selBoxArr.push(rows2);
                    commonEntitiesArr.push(commonEntities);
                    //res.send({result:true, iptUtterance:iptUtterance, entities:entities, selBox:rows2, commonEntities: commonEntities});
                } else {
                    iptUtteranceArr.push(iptUtterTmp);
                    entitiesArr.push(null);
                    selBoxArr.push(null);
                    commonEntitiesArr.push(null);
                    //res.send({result:true, iptUtterance:iptUtterance});
                }
            }
            res.send({result:true, iptUtterance:iptUtteranceArr, entities:entitiesArr, selBox:selBoxArr, commonEntities: commonEntitiesArr});

        } catch (err) {
            // ... error checks
            console.log(err);
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
        // ... error handler
    })

});


router.get('/entities', function (req, res) {

    req.session.selMenus = 'ms4';
    res.render('entities', {
        selMenus: req.session.selMenus,
    } );
});


router.post('/entities', function (req, res) {

    var currentPage = req.body.currentPage;

    (async () => {
        try {
         
            var entitiesQueryString = "SELECT tbp.* \n"    
                                    + "  FROM ( SELECT ROW_NUMBER() OVER(ORDER BY api_group DESC) AS NUM, \n"
                                    + "                COUNT('1') OVER(PARTITION BY '1') AS TOTCNT,  \n"
                                    + "                CEILING((ROW_NUMBER() OVER(ORDER BY api_group DESC))/ convert(numeric ,10)) PAGEIDX, \n" 
                                    + "                entity_value, entity, api_group \n"
                                    + "           from (   \n"
                                    + "                SELECT DISTINCT entity, API_GROUP ,  \n"
                                    + "                       STUFF(( SELECT '[' + b.entity_value + ']' \n"
                                    + "                                 FROM TBL_COMMON_ENTITY_DEFINE b \n"
                                    + "                                WHERE b.entity = a.entity FOR XML PATH('') ),1,1,'[') AS entity_value  \n"
                                    + "                  FROM TBL_COMMON_ENTITY_DEFINE a \n"
                                    + "                 WHERE API_GROUP != 'OCR TEST' \n"
                                    + "              GROUP BY entity, API_GROUP) tbl_common_entity_define \n"
                                    + "         WHERE api_group != 'OCR TEST') tbp \n"
                                    + "WHERE PAGEIDX = @currentPage; \n"
            
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).query(entitiesQueryString);

            let rows = result1.recordset;

            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var entitiyValue = rows[i].entity_value;
                var entity = rows[i].entity;
                var apiGroup = rows[i].api_group;

                item.ENTITY_VALUE = entitiyValue;
                item.ENTITY = entity;
                item.API_GROUP = apiGroup;

                result.push(item);
            }
            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT)});
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

//엔티티 밸류 추가
router.post('/addEntityValue', function (req, res) {
    
    var apiGroup = req.body.apiGroup;
    var entityDefine = req.body.entityDefine;
    var addEntityValue = req.body.addEntityValue;

    (async () => {
        try {

            var insertQueryString1 = "insert into TBL_COMMON_ENTITY_DEFINE(ENTITY, ENTITY_VALUE, API_GROUP) values(@entityDefine, @addEntityValue, @apiGroup)";
                      
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let result1 = await pool.request()
                .input('entityDefine', sql.NVarChar, entityDefine)
                .input('addEntityValue', sql.NVarChar, addEntityValue)
                .input('apiGroup', sql.NVarChar, apiGroup)
                .query(insertQueryString1);  
            
            res.send({status:200 , message:'insert Success'});
        
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'insert Entity Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })
    
});



//엔티티 삭제
router.post('/deleteEntity', function (req, res) {
    
    var delEntityDefine = req.body.delEntityDefine;
    var appName = req.session.appName;

    var delUtterId;
    var delEntityId;
    var delChildId;

    var saveLuisVerId;
    var findEntityName = '';
    //var client = new Client();
    
    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': req.session.subsKey
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

            var appCount = false;
            var useLuisAppId;

            for(var i = 0 ; i < selectAppId.recordset.length; i++) {
                var luisAppId = selectAppId.recordset[i].APP_ID;
                var luisVerId = selectAppId.recordset[i].VERSION;
                //luis intent count check
                var intentCountRes = syncClient.get(HOST + '/luis/api/v2.0/apps/' + luisAppId + '/versions/' + luisVerId + '/examples?take=500' , options);
                
                for(var k = 0; k < intentCountRes.body.length; k++) {
                    //text
                    
                    if (intentCountRes.body[k].text.trim() === delEntityDefine) {
                        useLuisAppId = luisAppId;
                        delUtterId = intentCountRes.body[k].id;
                        saveLuisVerId = luisVerId;
                        appCount = true;

                        var compareEntity = intentCountRes.body[k].entityLabels[0].entityName.split('::');
                        if (delEntityDefine == compareEntity[1]) {
                            findEntityName = compareEntity[0];
                        }
                    }
                }
            }

            if(appCount == false) {
                //create luis app 
                console.log("res 402");
                return res.send({result:402});
            }else{
                
                var entityListRes = syncClient.get(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/' + saveLuisVerId + '/hierarchicalentities?take=500' , options);
                appCount = false;
                for(var k = 0; k < entityListRes.body.length; k++) {
                    if( entityListRes.body[k].name == findEntityName ) {
                        
                        for(var j = 0 ; j < entityListRes.body[k].children.length; j++) {
                            if (entityListRes.body[k].children[j].name == delEntityDefine) {
                                delEntityId = entityListRes.body[k].id;
                                delChildId = entityListRes.body[k].children[j].id;
                                appCount = true;
                                break;
                            }
                        }
                    }
                    if (appCount) {
                        break;
                    }
                }

            }

            if(appCount == false) {
                //create luis app 
                console.log("res 403");
                return res.send({result:403});
            }else{
                //삭제
                var delUtterRes = syncClient.del(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/' + saveLuisVerId + '/examples/' + delUtterId , options);

                if (delUtterRes.statusCode > 200) {
                    console.log("res 406");
                    res.send({result:406});
                } else {
                    var delHierarChyChild = '';
                    delHierarChyChild += HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/' + saveLuisVerId;
                    delHierarChyChild += '/hierarchicalentities/' + delEntityId + '/children/' + delChildId;

                    var delUtterRes = syncClient.del(delHierarChyChild, options);

                    if (delUtterRes.statusCode > 200) {
                        console.log("res 407");
                        res.send({result:407});
                    } else {
                        

                        var client = new Client();

                        syncClient.post(HOST + '/luis/api/v2.0/apps/' + useLuisAppId + '/versions/0.1/train', options, function (data, response) {
                        
                        /*
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
                                        clearInterval(repeat);

                                        res.send({status:200 , message:'delete Success'});
                                    }
                                }
                            },1000);
                        */              
                            
                        });
                        
                        var deleteAppStr = "DELETE FROM TBL_COMMON_ENTITY_DEFINE WHERE ENTITY = '" + delEntityDefine + "'; \n";
                        let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

                        let result1 = await pool.request().query(deleteAppStr);  
                        
                    }
                }

            }
        } catch (err) {
            console.log(err);
            console.log("res 500");
            res.send({status:500 , message:'delete Entity Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })
    
});



//엔티티 추가
router.post('/insertEntity', function (req, res) {
    
    //var entityDefine = req.body.entityDefine;
    //var entityValue = req.body.entityValueList;
    //var apiGroup = req.body.apiGroup;
    var entityList = req.body;
    var entityTemp = [];
    if (entityList.entityDefine) {
        var tmpObj = new Object();
        tmpObj.entityDefine = entityList.entityDefine;
        tmpObj.apiGroup = entityList.apiGroup;
        tmpObj.entityValue = entityList.entityValue;
        entityTemp.push(tmpObj);
        entityList = entityTemp;
    }
    //var entityList = JSON.parse(req.body.entityObj);
    (async () => {
        try {
            var entityInputStr = "";
            entityInputStr += " SELECT COUNT(*) as count FROM TBL_COMMON_ENTITY_DEFINE \n";
            entityInputStr += "  WHERE 1=1 \n";
            entityInputStr += "    AND ENTITY = '" + entityList[0].entityDefine + "' \n";
            entityInputStr += "    AND API_GROUP = '" + entityList[0].apiGroup + "' \n";
            entityInputStr += "    AND ( ";
            for ( var i=0; i< entityList.length; i++) {
                if ( i !== 0) {entityInputStr += "     OR "}
                    entityInputStr += "ENTITY_VALUE = '" + entityList[i].entityValue + "' \n";
            }
            entityInputStr += "); \n";
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let result0 = await pool.request().query(entityInputStr);  
            /*
            var selectQuery  = ' SELECT COUNT(*) as count FROM TBL_COMMON_ENTITY_DEFINE ';
                selectQuery += ' WHERE ENTITY_VALUE = @entityValue ';
                selectQuery += ' AND ENTITY = @entityDefine ';
                selectQuery += ' AND API_GROUP = @apiGroup ';
            let result0 = await pool.request()
            .input('entityValue', sql.NVarChar, entityValue)
            .input('entityDefine', sql.NVarChar, entityDefine)
            .input('apiGroup', sql.NVarChar, apiGroup)
            .query(selectQuery);  
            */
            let rows = result0.recordset;

            if(rows[0].count == 0){

                var entityInputStr = "";
                for ( var i=0; i< entityList.length; i++) {
                    entityInputStr += " INSERT INTO tbl_common_entity_define(ENTITY, ENTITY_VALUE, API_GROUP) \n";
                    entityInputStr += " VALUES ('" + entityList[i].entityDefine + "', '" + entityList[i].entityValue + "', '" + entityList[i].apiGroup + "'); \n";
                }
                
                let result1 = await pool.request().query(entityInputStr);  

                res.send({status:200 , message:'insert Success'});
            }else{
                res.send({status:'Duplicate', message:'Duplicate entities exist'});
            }        
        
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'insert Entity Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })
    
});

//엔티티 수정
router.post('/updateEntity', function (req, res) {

    var entity = req.body.entityDefine;
    var updEntityValue = req.body.entityValue;
    var apiGroup = req.body.api_group;
    var oriEntityValue = [];
    var insertValue = [];
    var deleteValue = [];
    var intentInfo = [];
    var entityCheck = false;

    var appName = req.session.appName;
    var subsKey = req.session.subsKey;

    var options = {
        headers: {
            'Ocp-Apim-Subscription-Key': subsKey
        }
    };

    var client = new Client();

    var selEntityQuery = "SELECT ENTITY_VALUE, ENTITY, API_GROUP, TRAIN_FLAG\n";
    selEntityQuery += "FROM TBL_COMMON_ENTITY_DEFINE\n";
    selEntityQuery += "WHERE ENTITY = @entity";

    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME=@chatName)\n";

    var delEntityQuery = "DELETE FROM TBL_COMMON_ENTITY_DEFINE WHERE ENTITY_VALUE = @entityValue";

    var insertEntityQuery = "INSERT INTO TBL_COMMON_ENTITY_DEFINE(ENTITY_VALUE,ENTITY,API_GROUP,TRAIN_FLAG)\n";
    insertEntityQuery += "VALUES(@entityValue, @entity, @apiGroup, 'Y')";

    (async () => {
        try {
            let appPool = await appDbConnect.getAppConnection(appSql, req.session.appName, req.session.dbValue);

            let selEntity = await appPool.request()
                .input('entity', sql.NVarChar, entity)
                .query(selEntityQuery);
            
            var selEntityRecord = selEntity.recordset;

            for(var i = 0; i < selEntityRecord.length; i++) {
                oriEntityValue.push(selEntityRecord[i].ENTITY_VALUE);
            }

            deleteValue = JSON.parse(JSON.stringify(oriEntityValue));
            insertValue = JSON.parse(JSON.stringify(updEntityValue));

            for(var i = 0; i < selEntityRecord.length; i++) {
                for(var j = 0; j < updEntityValue.length; j++) {
                    if(oriEntityValue[i] == updEntityValue[j]) {
                        deleteValue.splice(deleteValue.indexOf(oriEntityValue[i]),1);
                        insertValue.splice(insertValue.indexOf(updEntityValue[i]),1);
                        break;
                    }
                }
            }

            //console.log(deleteValue);
            //console.log(insertValue);

            if(insertValue.length > 0 || deleteValue.length > 0) {
                let pool = await dbConnect.getConnection(sql);
                let selectAppId = await pool.request()
                    .input('chatName', sql.NVarChar, appName)
                    .query(selectAppIdQuery);

                console.log(intentInfo);
    
                for(var i = 0; i < selectAppId.recordset.length; i++) {
                    intentInfo[i] = syncClient.get(HOST + '/luis/api/v2.0/apps/' + selectAppId.recordset[i].APP_ID + '/versions/0.1/examples?take=500' , options);
                    intentInfo[i].appId = selectAppId.recordset[i].APP_ID;
                }

                for(var i = 0 ; i < insertValue.length; i++) {
                    for(var appNum = 0; appNum < intentInfo.length ; appNum++) {
                        if(intentInfo[appNum].body.length < 280) {
                            var getEntity = syncClient.get(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/hierarchicalentities' , options);

                            for(var eNum = 0; eNum < getEntity.body.length; eNum++) {
                                for( var cNum = 0; cNum < getEntity.body[eNum].children.length; cNum++) {
                                    if(entity == getEntity.body[eNum].children[cNum].name){
                                        entityCheck = true;
                                        break;
                                    }
                                }
                            }

                            if(entityCheck == false) {
                                var entityId = getEntity.body[getEntity.body.length-1].id;

                                var entityResult = syncClient.get(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId  + '/versions/0.1/hierarchicalentities/'+ entityId , options);

                                if(entityResult.body.children.length < 10) {
                                    options.payload = { "name" :  entity };
                                    // add hierarchicalentities
                                    var entityCreateResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/hierarchicalentities/'+ entityId + '/children', options);
                                } else {
                                    options.payload = {
                                        "name" : "entity" + (getEntity.body.length + 1),
                                        "children" : [entity]
                                    };
                                    // add hierarchicalentities list, entity
                                    var entityListResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/hierarchicalentities', options);
                                }
                            }

                            var getEntityName = syncClient.get(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/hierarchicalentities?take=500' , options);
                            var addEntity;
                            for(var k = 0; k < getEntityName.body.length; k++) {
                                for(var j = 0 ; j < getEntityName.body[k].children.length; j++) {
                                    if( getEntityName.body[k].children[j].name == entity ) {
                                        addEntity=getEntityName.body[k].name + "::" + entity;
                                    }
                                }
                            }

                            options.payload = {
                                "text" : insertValue[i],
                                "intentName" : "intent",
                                "entityLabels" :
                                [
                                    {
                                        "entityName": addEntity,
                                        "startCharIndex" : 0,
                                        "endCharIndex": insertValue[i].length-1
                                    }
                                ]
                            }

                            // add luis label
                            var addIntentLabel = syncClient.post(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/example' , options);

                            let insertEntity = await appPool.request()
                                .input('entityValue', sql.NVarChar, insertValue[i])
                                .input('entity', sql.NVarChar, entity)
                                .input('apiGroup', sql.NVarChar, apiGroup)
                                .query(insertEntityQuery);

                            break;
                        }
                    }
                }

                for(var delNum = 0; delNum < deleteValue.length; delNum++) {
                    for( var appNum = 0; appNum < intentInfo.length; appNum++) {
                        for( var utterNum = 0; utterNum < intentInfo[appNum].body.length; utterNum++) {
                            if(deleteValue[delNum] == intentInfo[appNum].body[utterNum].text) {
                                var delInfo = syncClient.del(HOST + '/luis/api/v2.0/apps/' + intentInfo[appNum].appId + '/versions/0.1/examples/' + intentInfo[appNum].body[utterNum].id , options)
                                
                                let delEntity = await appPool.request()
                                    .input('entityValue', sql.NVarChar, deleteValue[delNum])
                                    .query(delEntityQuery);

                                //console.log(delInfo);
                            
                            }
                        }
                    }
                }

                for(var i = 0; i < selectAppId.recordset.length; i++) {
                    var trainAppId = selectAppId.recordset[i].APP_ID;
                    client.post(HOST + '/luis/api/v2.0/apps/' + selectAppId.recordset[i].APP_ID + '/versions/0.1/train', options, function (data, response) {
                        client.get(HOST + '/luis/api/v2.0/apps/' + trainAppId + '/versions/0.1/train', options, function (data, response) {
                        });
                    });
                }
            }
            res.send({status:200});
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'insert Entity Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })


});

//엔티티 검색
router.post('/searchEntities', function (req, res) {

    var currentPage = req.body.currentPage;
    var searchEntities = req.body.searchEntities;
    
    (async () => {
        try {
         
            var entitiesQueryString = "SELECT tbp.* \n FROM "
                                    + "    (SELECT ROW_NUMBER() OVER(ORDER BY api_group DESC) AS NUM, \n"
                                    + "            COUNT('1') OVER(PARTITION BY '1') AS TOTCNT, \n"
                                    + "            CEILING((ROW_NUMBER() OVER(ORDER BY api_group DESC))/ convert(numeric ,10)) PAGEIDX, \n"
                                    + "            entity_value, entity, api_group from (SELECT DISTINCT entity, API_GROUP , \n"
                                    + "            STUFF(( SELECT '[' + b.entity_value + ']' \n "
                                    + "                      FROM TBL_COMMON_ENTITY_DEFINE b \n"
                                    + "                     WHERE b.entity = a.entity \n " 
                                    + "                       AND b.API_GROUP = a.API_GROUP FOR XML PATH('') ),1,1,'[') AS entity_value \n"
                                    + "      FROM TBL_COMMON_ENTITY_DEFINE a \n"
                                    + "     WHERE API_GROUP != 'OCR TEST' \n"
                                    + "       AND (entity like @searchEntities or entity_value like @searchEntities) \n"
                                    + "  GROUP BY entity, API_GROUP) a \n"
                                    + "      ) tbp  \n"
                                    + "WHERE PAGEIDX = 1 \n";
            
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1 = await pool.request().input('currentPage', sql.Int, currentPage).input('searchEntities', sql.NVarChar, '%'+searchEntities+'%').query(entitiesQueryString);

            let rows = result1.recordset;

            var result = [];
            for(var i = 0; i < rows.length; i++){
                var item = {};

                var entitiyValue = rows[i].entity_value;
                var entity = rows[i].entity;
                var apiGroup = rows[i].api_group;

                item.ENTITY_VALUE = entitiyValue;
                item.ENTITY = entity;
                item.API_GROUP = apiGroup;

                result.push(item);
            }
            if(rows.length > 0){
                res.send({list : result, pageList : paging.pagination(currentPage,rows[0].TOTCNT)});
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

router.post('/selectDlgListAjax', function (req, res) {

    var entity = [];
    entity = req.body['entity[]'];
    

    var relationText = "SELECT RNUM, LUIS_ENTITIES, A.DLG_ID DLG_ID, B.DLG_TYPE, DLG_ORDER_NO, LUIS_ID, LUIS_INTENT \n"
                     + "FROM (\n"
                     + "SELECT RANK() OVER(ORDER BY LUIS_ENTITIES) AS RNUM, LUIS_ENTITIES, DLG_ID, LUIS_ID, LUIS_INTENT \n"
                     + "FROM TBL_DLG_RELATION_LUIS \n"
                     + "WHERE 1=1\n";
    if(Array.isArray(entity)){
        for(var i = 0; i < entity.length; i++) {
            if(i == 0) {
                relationText += "AND LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            } else {
                relationText += "OR LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            }      
        }
    } else {
        relationText += "AND LUIS_ENTITIES LIKE '%" + entity +"%'\n";
    }
    
    relationText += "GROUP BY LUIS_ENTITIES, DLG_ID, LUIS_ID, LUIS_INTENT \n"
                 + ") A LEFT OUTER JOIN TBL_DLG B\n"
                 + "ON A.DLG_ID = B.DLG_ID \n"
                 + "WHERE RNUM = 1\n"
                 + "ORDER BY LUIS_ENTITIES desc, DLG_ORDER_NO";

    var dlgText = "SELECT DLG_ID, CARD_TITLE, CARD_TEXT, USE_YN, '2' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_TEXT\n"
                  + "WHERE USE_YN = 'Y'\n"
                  + "AND DLG_ID IN (\n"
                  + "SELECT DISTINCT DLG_ID\n"
                  + "FROM TBL_DLG_RELATION_LUIS\n"
                  + "WHERE 1=1\n";
    if(Array.isArray(entity)){
        for(var i = 0; i < entity.length; i++) {
            if(i == 0) {
                dlgText += "AND LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            } else {
                dlgText += "OR LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            }
        }
    } else {
        dlgText += "AND LUIS_ENTITIES LIKE '%" + entity +"%'\n";
    }

    dlgText += ") \n ORDER BY DLG_ID";

    var dlgCard = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, IMG_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
                  + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
                  + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
                  + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
                  + "CARD_ORDER_NO, CARD_VALUE,\n"
                  + "USE_YN, '3' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_CARD\n"
                  + "WHERE USE_YN = 'Y'\n"
                  + "AND DLG_ID IN (\n"
                  + "SELECT DISTINCT DLG_ID\n"
                  + "FROM TBL_DLG_RELATION_LUIS\n"
                  + "WHERE 1=1\n";
    if(Array.isArray(entity)){
        for(var i = 0; i < entity.length; i++) {
            if(i == 0) {
                dlgCard += "AND LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            } else {
                dlgCard += "OR LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            }
        }
    } else{
        dlgCard += "AND LUIS_ENTITIES LIKE '%" + entity +"%'\n";
    }

    dlgCard += ") \n ORDER BY DLG_ID";
    
    var dlgMedia = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, MEDIA_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
                  + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
                  + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
                  + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
                  + "CARD_VALUE,\n"
                  + "USE_YN, '4' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_MEDIA\n"
                  + "WHERE USE_YN = 'Y'\n"
                  + "AND DLG_ID IN (\n"
                  + "SELECT DISTINCT DLG_ID\n"
                  + "FROM TBL_DLG_RELATION_LUIS\n"
                  + "WHERE 1=1\n";
    
    if(Array.isArray(entity)){
        for(var i = 0; i < entity.length; i++) {
            if(i == 0) {
                dlgMedia += "AND LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            } else {
                dlgMedia += "OR LUIS_ENTITIES LIKE '%" + entity[i] +"%'\n";
            }
        }
    } else {
        dlgMedia += "AND LUIS_ENTITIES LIKE '%" + entity +"%'\n";
    }

    dlgMedia += ") \n ORDER BY DLG_ID";

    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let dlgTextResult = await pool.request()
                .query(dlgText);
            let rowsText = dlgTextResult.recordset;

            let dlgCardResult = await pool.request()
                .query(dlgCard);
            let rowsCard = dlgCardResult.recordset;

            let dlgMediaResult = await pool.request()
                .query(dlgMedia);
            let rowsMedia = dlgMediaResult.recordset;
            
            let result1 = await pool.request()
                .query(relationText)
            let rows = result1.recordset;
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var row = {};
                row.RNUM = rows[i].RNUM;
                row.LUIS_ENTITIES = rows[i].LUIS_ENTITIES;
                row.DLG_ID = rows[i].DLG_ID;
                row.DLG_TYPE = rows[i].DLG_TYPE;
                row.DLG_ORDER_NO = rows[i].DLG_ORDER_NO;
                row.LUIS_ID = rows[i].LUIS_ID;
                row.LUIS_INTENT = rows[i].LUIS_INTENT;
                row.dlg = [];

                let dlg_type = rows[i].DLG_TYPE;
                if(dlg_type == 2){
                    for(var j = 0; j < rowsText.length; j++){
                        let textDlgId = rowsText[j].DLG_ID;
                        if(row.DLG_ID == textDlgId){
                            row.dlg.push(rowsText[j]);
                        }
                    }
                }else if(dlg_type == 3){
                    for(var j = 0; j < rowsCard.length; j++){
                        var cardDlgId = rowsCard[j].DLG_ID;
                        if(row.DLG_ID == cardDlgId){
                            row.dlg.push(rowsCard[j]);
                        }
                    }
                }else if(dlg_type == 4){
                    for(var j = 0; j < rowsMedia.length; j++){
                        var mediaDlgId = rowsMedia[j].DLG_ID;
                        if(row.DLG_ID == mediaDlgId){
                            row.dlg.push(rowsMedia[j]);
                        }
                    }
                }
                result.push(row);
            }

            res.send({list : result});
        
        } catch (err) {
            console.log(err);
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        console.log(err);
    })
});

//다이얼로그 추가
router.post('/insertDialog', function (req, res) {
    res.send({status:600 , message:'ing...'});
    /*
    var sourceType = req.body.sourceType;
    var largeGroup = req.body.largeGroup;
    var mediumGroup = req.body.mediumGroup;
    var smallGroup = req.body.smallGroup;
    var description = util.nullCheck(req.body.description, null);

    var dlgType = req.body.dlgType; // 2 : text , 3 : carousel , 4 : media
    var dialogOrderNo = req.body.dialogOrderNo;
    var dialogText = util.nullCheck(req.body.dialogText, null);

    var cardOrderNo = req.body.cardOrderNo;

    var buttonName1 = util.nullCheck(req.body.buttonName1, null);
    var buttonName2 = util.nullCheck(req.body.buttonName2, null);
    var buttonName3 = util.nullCheck(req.body.buttonName3, null);
    var buttonName4 = util.nullCheck(req.body.buttonName4, null);
    var buttonContent1 = util.nullCheck(req.body.buttonContent1, null);
    var buttonContent2 = util.nullCheck(req.body.buttonContent2, null);
    var buttonContent3 = util.nullCheck(req.body.buttonContent3, null);
    var buttonContent4 = util.nullCheck(req.body.buttonContent4, null);
    var btn1Type = (buttonName1 != null)? 'imBack' : null;
    var btn2Type = (buttonName2 != null)? 'imBack' : null;
    var btn3Type = (buttonName3 != null)? 'imBack' : null;
    var btn4Type = (buttonName4 != null)? 'imBack' : null;
    var imgUrl = util.nullCheck(req.body.imgUrl, null);

    (async () => {
        try {

            var selectQueryString1 = 'SELECT ISNULL(MAX(DLG_ID)+1,1) AS DLG_ID FROM TBL_DLG';
            let pool = await sql.connect(dbConfig)
            let result1 = await pool.request()
                .query(selectQueryString1)
            let rows1 = result1.recordset;
            
            var insertQueryString1 = 'INSERT INTO TBL_DLG(DLG_ID,DLG_NAME,DLG_DESCRIPTION,DLG_LANG,DLG_TYPE,DLG_ORDER_NO,USE_YN) VALUES ' +
            '(@dlgId,@dialogText,@dialogText,\'KO\',@dlgType,@dialogOrderNo,\'Y\')';

            let result2 = await pool.request()
                .input('dlgId', sql.Int, rows1[0].DLG_ID)
                .input('dialogText', sql.NVarChar, dialogText)
                .input('dlgType', sql.NVarChar, dlgType)
                .input('dialogOrderNo', sql.Int, dialogOrderNo)
                .query(insertQueryString1)  
            //let rows2 = result2.recordset;
            
            var selectQueryString2 = '';
            if(dlgType == '2'){
                selectQueryString2 = 'SELECT ISNULL(MAX(TEXT_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_TEXT';
            }else if(dlgType == '3'){
                selectQueryString2 = 'SELECT ISNULL(MAX(CARD_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_CARD';
            }else if(dlgType == '4'){
                selectQueryString2 = 'SELECT ISNULL(MAX(MEDIA_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_MEDIA';
            }else{
            }
            
            let result3 = await pool.request()
                .query(selectQueryString2)
            let rows3 = result3.recordset; //rows3[0].TYPE_DLG_ID

            var insertQueryString2 = '';
            if(dlgType == '2'){
                insertQueryString2 = 'INSERT INTO TBL_DLG_TEXT(TEXT_DLG_ID,DLG_ID,CARD_TEXT,USE_YN) VALUES ' +
                '(@typeDlgId,@dlgId,@dialogText,\'Y\')';
            }else if(dlgType == '3'){
                insertQueryString2 = 'INSERT INTO TBL_DLG_CARD(CARD_DLG_ID,DLG_ID,CARD_TEXT,IMG_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_ORDER_NO,USE_YN) VALUES ' +
                '(@typeDlgId,@dlgId,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardOrderNo,\'Y\')';
            }else if(dlgType == '4'){
                insertQueryString2 = 'INSERT INTO TBL_DLG_MEDIA(MEDIA_DLG_ID,DLG_ID,CARD_TEXT,MEDIA_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,USE_YN) VALUES ' +
                '(@typeDlgId,@dlgId,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,\'Y\')';
            }else{
            }

            let result4 = await pool.request()
                .input('typeDlgId', sql.Int, rows3[0].TYPE_DLG_ID)
                .input('dlgId', sql.Int, rows1[0].DLG_ID)
                .input('dialogText', sql.NVarChar, dialogText)
                .input('imgUrl', sql.NVarChar, imgUrl)
                .input('btn1Type', sql.NVarChar, btn1Type)
                .input('buttonName1', sql.NVarChar, buttonName1)
                .input('buttonContent1', sql.NVarChar, buttonContent1)
                .input('btn2Type', sql.NVarChar, btn2Type)
                .input('buttonName2', sql.NVarChar, buttonName2)
                .input('buttonContent2', sql.NVarChar, buttonContent2)
                .input('btn3Type', sql.NVarChar, btn3Type)
                .input('buttonName3', sql.NVarChar, buttonName3)
                .input('buttonContent3', sql.NVarChar, buttonContent3)
                .input('btn4Type', sql.NVarChar, btn4Type)
                .input('buttonName4', sql.NVarChar, buttonName4)
                .input('buttonContent4', sql.NVarChar, buttonContent4)
                .input('cardOrderNo', sql.NVarChar, cardOrderNo)
                .query(insertQueryString2)

            res.send({status:200 , message:'insert Success', DLG_ID: rows1[0].DLG_ID, CARD_TEXT: dialogText});
        
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'insert Dialog Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })
    */
});

router.post('/learnUtterAjax', function (req, res) {
    var luisId = req.body.luisId;
    var luisIntent = req.body.luisIntent;

    var entities = req.body.entities;
    var predictIntent = req.body.predictIntent;
    
    var dlgId = [];
    dlgId = req.body['dlgId[]'];

    var queryText = "INSERT INTO TBL_DLG_RELATION_LUIS(LUIS_ID,LUIS_INTENT,LUIS_ENTITIES,DLG_ID,DLG_API_DEFINE,USE_YN) "
                  + "VALUES( @luisId, @luisIntent, @entities, @dlgId, 'D', 'Y' ); \n";

    var updateQueryText = "";
    var utterArry;
    if (req.body['utters[]']) {
        utterArry = req.body['utters[]'];
        utterArry = utterArry.replace("'","''");
        for (var i=0; i<(typeof utterArry ==="string" ? 1:utterArry.length); i++) {    
            updateQueryText += "UPDATE TBL_QUERY_ANALYSIS_RESULT SET TRAIN_FLAG = 'Y' WHERE QUERY = '" + (typeof utterArry ==="string" ? utterArry.replace(" ",""):utterArry[i]) + "'; \n";
        }
    }

    
    var updateTblDlg = "UPDATE TBL_DLG SET GroupS = @entities WHERE DLG_ID = @dlgId; \n";

    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME='"+req.session.appName+"')\n";

    var upQuery = "UPDATE TBL_QUERY_ANALYSIS_RESULT SET LUIS_ID = @luisID, LUIS_INTENT = @intetID, LUIS_INTENT_SCORE = '1', RESULT = 'H' "
                + "WHERE QUERY = @Query";

    var inCacheQuery = "INSERT INTO TBL_QUERY_INTENT(QUERY, LUIS_ID, LUIS_INTENT, DLG_ID)\n"
                     + "VALUES(@query,@luisId, @intent, @dlgId)";

    var selCacheQuery = "SELECT QUERY, LUIS_ID, LUIS_INTENT, DLG_ID\n"
                      + "FROM TBL_QUERY_INTENT\n"
                      + "WHERE QUERY = @query\n"
                      + "AND LUIS_ID = @luisId\n"
                      + "AND LUIS_INTENT = @intent\n"
                      + "AND DLG_ID = @dlgID";

    var checkQuery = "SELECT RELATION_ID FROM TBL_DLG_RELATION_LUIS WHERE LUIS_INTENT = @luisIntent AND DLG_ID = @dlgId AND LUIS_ID = @luisId";
    
    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let result1;
            let result2;
            let checkResult;
            /*
            if(typeof dlgId == "string") {
                result1 = await pool.request()
                                .input('luisId', sql.NVarChar, luisId)
                                .input('luisIntent', sql.NVarChar, luisIntent)
                                .input('entities', sql.NVarChar, entities)
                                .input('dlgId', sql.NVarChar, dlgId)
                                .query(queryText);
            } else {
                for(var i = 0 ; i < dlgId.length; i++) {
                    result1 = await pool.request()
                                    .input('luisId', sql.NVarChar, luisId)
                                    .input('luisIntent', sql.NVarChar, luisIntent)
                                    .input('entities', sql.NVarChar, entities)
                                    .input('dlgId', sql.NVarChar, dlgId[i])
                                    .query(queryText);
                }
            }*/

            /*
            for(var i = 0 ; i < (typeof entities ==="string" ? 1:entities.length); i++) {

                for(var j = 0 ; j <dlgLen; j++){
                    if (j === dlgLen-1) {
                        queryText += updateQueryText
                    }
                    result1 = await pool.request()
                                    .input('luisId', sql.NVarChar, luisId)
                                    .input('luisIntent', sql.NVarChar, luisIntent)
                                    .input('entities', sql.NVarChar, (typeof entities ==="string" ? entities:entities[i]))
                                    .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                    .query(queryText);
                    
                    result2 = await pool.request()
                                    .input('entities', sql.NVarChar, (typeof entities ==="string" ? entities:entities[i]))
                                    .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                    .query(updateTblDlg);
                    
                }
            }
            */
           /*
           * 이미 학습되어서 디비에 들어간 내용을 다시 학습시키는 것을 방지함.
           * */
           for(var jjj = 0 ; jjj < (typeof dlgId ==="string" ? 1:dlgId.length); jjj++){
            checkResult = await pool.request()
                .input('luisId', sql.NVarChar, luisId)
                .input('luisIntent', sql.NVarChar, luisIntent)
                .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[jjj]))
                .query(checkQuery);

                if(checkResult.recordset.length > 0) {
                    return res.send({result:"learned"});
                }else{
                    //nothing
                }
           }
           


            for(var j = 0 ; j < (typeof dlgId ==="string" ? 1:dlgId.length); j++){
                if (j === ((typeof dlgId ==="string" ? 1:dlgId.length) - 1)) {
                    queryText += updateQueryText
                }

                if(entities != "" && entities != null) {
                    result1 = await pool.request()
                                .input('luisId', sql.NVarChar, luisId)
                                .input('luisIntent', sql.NVarChar, luisIntent)
                                .input('entities', sql.NVarChar, entities)
                                .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                .query(queryText);
                
                
                    result2 = await pool.request()
                                    .input('entities', sql.NVarChar, entities)
                                    .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                    .query(updateTblDlg);
                } else {

                    var selCacheResult = await pool.request()
                                            .input('query', sql.NVarChar, req.body['utters[]'].replace(" ",""))
                                            .input('luisId', sql.NVarChar, luisId)
                                            .input('intent', sql.NVarChar, luisIntent)
                                            .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                            .query(selCacheQuery)

                    if(selCacheResult.recordset.length == 0) {
                        /*
                        * entity 가 없어도 TBL_DLG_RELATION_LUIS 에는 insert
                        * entity 가 없으면 TBL_DLG_RELATION_LUIS table 을 보지 않고 TBL_QUERY_INTENT table 에서 정보를 빼온다.
                        * entity 가 없으니까 tbl_dlg 의 groups 를 update 할 필요는 없다.
                        */
                        var regExpData = /[\{\}\[\]\/?.,;:|\)*~`!^\-_+<>@\#$%&\\\=\(\'\"]/gi;//특수문자
                        var query_ori_data = req.body['utters[]'];
                        var query_data = query_ori_data.replace(regExpData, "");//특수문자 제거
                        query_data = query_data.replace(/(\s*)/g,"");//공백제거
                        var relationLuisResult = await pool.request()
                                .input('luisId', sql.NVarChar, luisId)
                                .input('luisIntent', sql.NVarChar, luisIntent)
                                .input('entities', sql.NVarChar, entities)
                                .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                .query(queryText);
                        var inCacheResult = await pool.request()
                                //.input('query', sql.NVarChar, req.body['utters[]'].replace(" ",""))
                                .input('query', sql.NVarChar, query_data)
                                .input('luisId', sql.NVarChar, luisId)
                                .input('intent', sql.NVarChar, luisIntent)
                                .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
                                .query(inCacheQuery);
                    }
                }
            }
            
            /*
           result2 = await pool.request()
           .input('entities', sql.NVarChar, (typeof entities ==="string" ? entities:entities[i]))
           .input('dlgId', sql.NVarChar, (typeof dlgId ==="string" ? dlgId:dlgId[j]))
           .query(updateTblDlg);

           if(typeof dlgId == "string") {
                queryText += updateQueryText
                result1 = await pool.request()
                                .input('luisId', sql.NVarChar, luisId)
                                .input('luisIntent', sql.NVarChar, luisIntent)
                                .input('entities', sql.NVarChar, entities)
                                .input('dlgId', sql.NVarChar, dlgId)
                                .query(queryText);
            } else {
                for(var i = 0 ; i < dlgId.length; i++) {

                    if (i === dlgId.length-1) {
                        queryText += updateQueryText
                    }

                    result1 = await pool.request()
                                    .input('luisId', sql.NVarChar, luisId)
                                    .input('luisIntent', sql.NVarChar, luisIntent)
                                    .input('entities', sql.NVarChar, entities)
                                    .input('dlgId', sql.NVarChar, dlgId[i])
                                    .query(queryText);
                }
            }
            */

            /*
            * 루이스에 선택된 intent에 utterance 를 넣는다.
            * 그 후에 train 시킨다.
            *  20180330 Jun Hyoung Park
            */
           var insertUtter;
           var appId;
           let selectAppId1;

           let pool1 = await dbConnect.getConnection(sql);
           
           selectAppId1 = await pool1.request()
               .query(selectAppIdQuery);

           
           for(var i = 0; i < selectAppId1.recordset.length; i++) {
                appId = selectAppId1.recordset[i].APP_ID;
            }
            
            var options = {
                headers: {
                    'Ocp-Apim-Subscription-Key': req.session.subsKey
                }
            };

           if (req.body['utters[]']) {
            insertUtter = req.body['utters[]'];
            for (var i=0; i<(typeof utterArry ==="string" ? 1:utterArry.length); i++) {    
                insertUtter = (typeof utterArry ==="string" ? utterArry:utterArry[i]);

                if(entities == null || entities == "") {

                    var selectQueryResult = await pool.request()
                                                    .input('Query', sql.NVarChar, insertUtter.replace(" ", ""))
                                                    .query("SELECT QUERY FROM TBL_QUERY_ANALYSIS_RESULT WHERE QUERY = @Query");

                    if(selectQueryResult.recordset.length > 0) {
                        var upResult = await pool.request()
                                            .input('Query', sql.NVarChar,  insertUtter.replace(" ",""))
                                            .input('luisID', sql.NVarChar,  luisId)
                                            .input('intetID', sql.NVarChar, luisIntent)
                                            .query(upQuery)
                    } else {
                        var spResult = await pool.request()
                                .input('Query', sql.NVarChar,  insertUtter.replace(" ",""))
                                .input('intentID', sql.NVarChar, luisIntent)
                                .input('entitiesIDS', sql.NVarChar, 'none')
                                .input('intentScore', sql.NVarChar, '1')
                                .input('luisID', sql.NVarChar, luisId)
                                .input('result', sql.NVarChar, 'H')
                                .input('appID', sql.NVarChar, '')
                                .execute('sp_insertusehistory4')
                    }
                }
            }

            var publish_flag = "N";
            var predictIntent_ = predictIntent;
            var temp = predictIntent_.split("::");
            var predictIntent_luis;
            if(temp.length==0){
                predictIntent_luis = predictIntent_;
                
            }else{
                predictIntent_luis = temp[0];
            }
            //새로생성인지 기존것 선택인지 구분(새로생성시에는 스코어가 없다)
            if(predictIntent_.match(/::/)){

            }else{
                publish_flag = "Y";
            }

            var getIntentName = syncClient.get(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/intents?take=500' , options);
            
            var createIntent = true;

            for(var intentNum = 0; intentNum < getIntentName.body.length; intentNum++) {
                if(predictIntent_luis == getIntentName.body[intentNum].name){
                    createIntent = false;
                    break;
                }
            }

            if(createIntent == true) {

                var intentOptions = {
                    headers: {
                        'Ocp-Apim-Subscription-Key': req.session.subsKey
                    }
                };

                intentOptions.payload = {
                    "name": predictIntent_luis
                }

                var createIntentName = syncClient.post(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/intents' , intentOptions);
                //var temp1 = JSON.stringify(createIntentName);
                //console.log("createIntentName=="+temp1);
            }

            var getEntityName = syncClient.get(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/hierarchicalentities?take=500' , options);
            var addEntity = "";
            //console.log("entities ="+ req.body.entities);

            options.payload = [{
                "text" : insertUtter,
                "intentName" : predictIntent_luis,
                "entityLabels" : []
            }]
            /*
            -- entity 추출하는 부분인데...
            -- intent 등록시에 넣어야 할듯 한데 조금 아리까리 하네.
            var entities_temp = entities.split(",");
            for(var ii=0; ii<entities_temp.length; ii++){
                for(var k = 0; k < getEntityName.body.length; k++) {
                    for(var j = 0 ; j < getEntityName.body[k].children.length; j++) {
                        //console.log("aaa==="+getEntityName.body[k].children[j].name);
                        //console.log("bbb==="+getEntityName.body[k].name);
                        if( getEntityName.body[k].children[j].name == entities_temp[ii] ) {
                            addEntity=addEntity + getEntityName.body[k].name + "::" + getEntityName.body[k].children[j].name;

                            var json = new Object();
                            json.entityName = addEntity;
                            json.startCharIndex = insertUtter.indexOf(entities_temp[ii]);
                            json.endCharIndex = insertUtter.indexOf(entities_temp[ii]) + entities_temp[ii].length -1;
                            options.payload[0].entityLabels.push(json);
                        }
                    }
                }
            }
            console.log("addEntity ="+ addEntity);
            var addEntity_temp = addEntity.split("//");
            console.log("addEntity_temp ="+ addEntity_temp.length);
                    */  
            //console.log("insertUtter==="+insertUtter+"/////intentName==="+predictIntent_luis);
            //add luis utterance
            var addUtterance = syncClient.post(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/examples' , options);
            //var temp = JSON.stringify(addUtterance);
            //console.log("addUtterance=="+temp);
            //luis train
            //var trainLuis = syncClient.post(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/train' , options);
            //var temp = JSON.stringify(trainLuis);
            //console.log("train temp===="+temp);
            //console.log("publish_flag===="+publish_flag);

            var trainOptions = {
                headers: {
                    'Ocp-Apim-Subscription-Key': req.session.subsKey
                }
            };

            var client = new Client();

            client.post(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/train', trainOptions, function (data, response) {

                var repeat = setInterval(function(){
                    var count = 0;
                    var traninResultGet = syncClient.get(HOST + '/luis/api/v2.0/apps/' + appId + '/versions/0.1/train' , trainOptions);

                    console.log("traninResultGet==="+traninResultGet.body.length);

                    for(var trNum = 0; trNum < traninResultGet.body.length; trNum++) {
                        if(traninResultGet.body[trNum].details.status == "Fail") {
                            console.log("status fail===");
                            clearInterval(repeat);
                            return res.send({result:false});
                        }
                        if(traninResultGet.body[trNum].details.status == "InProgress") {
                            console.log("status InProgress===");
                            break;
                        }
                        count++;

                        if(traninResultGet.body.length == count) {
                            console.log("status ok===");
                            var pubOption = {
                                headers: {
                                    'Ocp-Apim-Subscription-Key': req.session.subsKey,
                                    'Content-Type':'application/json'
                                },
                                payload:{
                                    'versionId': '0.1',
                                    'isStaging': false,
                                    'region': 'westus'
                                }
                            }

                            var publishResult = syncClient.post(HOST + '/luis/api/v2.0/apps/' + appId + '/publish' , pubOption);

                            clearInterval(repeat);

                            return res.send({result:true});
                        }
                    }


                },1000);
          
            });



            /*
            if(publish_flag=="Y"){
                //luis publish
                options.payload = {
                    "versionId" : "0.1",
                    "isStaging" : false,
                    "region" : "westus"
                }
                var publishLuis = syncClient.post(HOST + '/luis/api/v2.0/apps/' + appId + '/publish' , options);
                var temp = JSON.stringify(publishLuis);
                console.log("publish temp===="+temp);
                
            }else{
                //nothing
            }
            */
           }else{

           }
        /********************************************* */
            //console.log(result1);
            //console.log(result2);

            /*
            let rows = result1.rowsAffected;

            if(rows[0] == 1) {
                res.send({result:true});
            } else {
                res.send({result:false});
            }
            */
        
        } catch (err) {
            // ... error checks
            console.log(err);
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
        // ... error handler
    })
});


router.post('/deleteRecommend',function(req,res){
    var seqs = req.body.seq;
    var arryseq = seqs.split(',');
        (async () => {
        try{
                let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
                for(var i = 0 ; i < arryseq.length; i ++)
                {
                   var deleteQueryString1 = "UPDATE TBL_QUERY_ANALYSIS_RESULT SET TRAIN_FLAG = 'Y' WHERE seq='"+arryseq[i]+"'";
                   let result5 = await pool.request().query(deleteQueryString1);
                }
                res.send();
            }catch(err){
            
            }finally {
                sql.close();
            } 
        })()
        
        sql.on('error', err => {
            console.log(err);
        })
});

router.post('/selectGroup',function(req,res){
    var selectId = req.body.selectId;
    var selectValue1 = req.body.selectValue1;
    var selectValue2 = req.body.selectValue2;
    (async () => {
    try{
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            var queryText = "";
            if(selectId == "searchLargeGroup") {
                queryText = "SELECT DISTINCT GroupL AS 'GROUP' FROM TBL_DLG WHERE GroupL IS NOT NULL";
            } else if(selectId == "searchMediumGroup") {
                selectValue1 = selectValue1.trim();
                queryText = "SELECT DISTINCT GroupM AS 'GROUP'\n";
                queryText += "FROM TBL_DLG\n";
                queryText += "WHERE GroupM IS NOT NULL\n";
                queryText += "AND GroupL = '" + selectValue1 + "'";
            } else if(selectId == "searchSmallGroup") {
                selectValue1 = selectValue1.trim();
                selectValue2 = selectValue2.trim();
                queryText = "SELECT DISTINCT GroupS AS 'GROUP'\n";
                queryText += "FROM TBL_DLG\n";
                queryText += "WHERE GroupS IS NOT NULL\n";
                queryText += "AND GroupL = '" + selectValue1 + "'\n";
                queryText += "AND GroupM = '" + selectValue2 + "'";
            }

            let result = await pool.request().query(queryText);
            var rows = result.recordset;

            res.send({rows:rows});
        }catch(err){
            console.log(err);
        }finally {
            sql.close();
        } 
    })()
    
    sql.on('error', err => {
        console.log(err);
    })
});

/* 릴레이션 버전
router.post('/searchDialog',function(req,res){
    var searchLargeGroup = req.body.searchLargeGroup;
    var searchMediumGroup = req.body.searchMediumGroup;
    var searchSmallGroup = req.body.searchSmallGroup;
    var serachDlg = req.body.serachDlg.trim();
    
    var relationText = "SELECT RNUM, LUIS_ENTITIES, A.DLG_ID DLG_ID, B.DLG_TYPE, DLG_ORDER_NO, LUIS_ID, LUIS_INTENT \n";
        relationText += "FROM (\n";
        relationText += "SELECT RANK() OVER(ORDER BY LUIS_ENTITIES) AS RNUM, LUIS_ENTITIES, DLG_ID, LUIS_ID, LUIS_INTENT \n";
        relationText += "FROM TBL_DLG_RELATION_LUIS \n";
        relationText += "WHERE 1=1\n";
        if(serachDlg) {

            relationText += "AND LUIS_ENTITIES like '%" + serachDlg + "%'\n";
        } else {
            
            if(searchLargeGroup) {
                relationText += "AND LUIS_ID = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    relationText += "AND LUIS_INTENT = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        relationText += "AND LUIS_ENTITIES LIKE '%" + searchSmallGroup + "%'\n";
                    }
                }
            }
        }
        relationText += "AND DLG_API_DEFINE = 'D' \n";
        relationText += "GROUP BY LUIS_ENTITIES, DLG_ID, LUIS_ID, LUIS_INTENT \n";
        relationText += ") A LEFT OUTER JOIN TBL_DLG B\n";
        relationText += "ON A.DLG_ID = B.DLG_ID \n";
        relationText += "ORDER BY LUIS_ENTITIES, DLG_ORDER_NO";

    var dlgText = "SELECT DLG_ID, CARD_TITLE, CARD_TEXT, USE_YN, '2' AS DLG_TYPE \n"
        dlgText += "FROM TBL_DLG_TEXT\n";
        dlgText += "WHERE USE_YN = 'Y'\n"
        dlgText += "AND DLG_ID IN (\n"
        dlgText += "SELECT DISTINCT DLG_ID\n"
        dlgText += "FROM TBL_DLG_RELATION_LUIS\n"
        dlgText += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgText += "AND LUIS_ENTITIES like '%" + serachDlg + "%'\n";
        } else {
            if(searchLargeGroup) {
                dlgText += "AND LUIS_ID = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgText += "AND LUIS_INTENT = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgText += "AND LUIS_ENTITIES LIKE '%" + searchSmallGroup + "%'\n";
                    }
                }
            }   
        }
        dlgText += ") \n ORDER BY DLG_ID";

    var dlgCard = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, IMG_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n";
        dlgCard += "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n";
        dlgCard += "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n";
        dlgCard += "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n";
        dlgCard += "CARD_ORDER_NO, CARD_VALUE,\n";
        dlgCard += "USE_YN, '3' AS DLG_TYPE \n";
        dlgCard += "FROM TBL_DLG_CARD\n";
        dlgCard += "WHERE USE_YN = 'Y'\n";
        dlgCard += "AND DLG_ID IN (\n";
        dlgCard += "SELECT DISTINCT DLG_ID\n";
        dlgCard += "FROM TBL_DLG_RELATION_LUIS\n";
        dlgCard += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgCard += "AND LUIS_ENTITIES like '%" + serachDlg + "%'\n";
        } else {

            if(searchLargeGroup) {
                dlgCard += "AND LUIS_ID = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgCard += "AND LUIS_INTENT = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgCard += "AND LUIS_ENTITIES LIKE '%" + searchSmallGroup + "%'\n";
                    }
                }
            }
        }
        dlgCard += "AND DLG_API_DEFINE = 'D' \n";
        dlgCard += ") \n ORDER BY DLG_ID";
    
    var dlgMedia = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, MEDIA_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n";
        dlgMedia += "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n";
        dlgMedia += "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n";
        dlgMedia += "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n";
        dlgMedia += "CARD_VALUE,\n";
        dlgMedia += "USE_YN, '4' AS DLG_TYPE \n";
        dlgMedia += "FROM TBL_DLG_MEDIA\n";
        dlgMedia += "WHERE USE_YN = 'Y'\n";
        dlgMedia += "AND DLG_ID IN (\n";
        dlgMedia += "SELECT DISTINCT DLG_ID\n";
        dlgMedia += "FROM TBL_DLG_RELATION_LUIS\n";
        dlgMedia += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgMedia += "AND LUIS_ENTITIES like '%" + serachDlg + "%'\n";
        } else {

            if(searchLargeGroup) {
                dlgMedia += "AND LUIS_ID = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgMedia += "AND LUIS_INTENT = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgMedia += "AND LUIS_ENTITIES LIKE '%" + searchSmallGroup + "%'\n";
                    }
                }
            }
        }
        dlgMedia += "AND DLG_API_DEFINE = 'D' \n";
        dlgMedia += ") \n ORDER BY DLG_ID";

    (async () => {
        try{
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let dlgTextResult = await pool.request()
                .query(dlgText);
            let rowsText = dlgTextResult.recordset;

            let dlgCardResult = await pool.request()
                .query(dlgCard);
            let rowsCard = dlgCardResult.recordset;

            let dlgMediaResult = await pool.request()
                .query(dlgMedia);
            let rowsMedia = dlgMediaResult.recordset;
            
            let result1 = await pool.request()
                .query(relationText)
            let rows = result1.recordset;
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var row = {};
                row.RNUM = rows[i].RNUM;
                row.LUIS_ENTITIES = rows[i].LUIS_ENTITIES;
                row.DLG_ID = rows[i].DLG_ID;
                row.DLG_TYPE = rows[i].DLG_TYPE;
                row.DLG_ORDER_NO = rows[i].DLG_ORDER_NO;
                row.LUIS_ID = rows[i].LUIS_ID;
                row.LUIS_INTENT = rows[i].LUIS_INTENT;
                row.dlg = [];
                
                let dlg_type = rows[i].DLG_TYPE;
                if(dlg_type == 2){
                    for(var j = 0; j < rowsText.length; j++){
                        let textDlgId = rowsText[j].DLG_ID;
                        if(row.DLG_ID == textDlgId){
                            row.dlg.push(rowsText[j]);
                        }
                    }
                }else if(dlg_type == 3){
                    for(var j = 0; j < rowsCard.length; j++){
                        var cardDlgId = rowsCard[j].DLG_ID;
                        if(row.DLG_ID == cardDlgId){                       
                            row.dlg.push(rowsCard[j]);
                        }
                    }
                }else if(dlg_type == 4){
                    for(var j = 0; j < rowsMedia.length; j++){
                        var mediaDlgId = rowsMedia[j].DLG_ID;
                        if(row.DLG_ID == mediaDlgId){
                            row.dlg.push(rowsMedia[j]);
                        }
                    }
                }
                result.push(row);
            }

            res.send({list : result});
        
        }catch(err){
            console.log(err);
        }finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
        sql.close();
        console.log(err);
    })

});
*/

router.post('/searchDialog',function(req,res){
    var searchLargeGroup = req.body.searchLargeGroup;
    var searchMediumGroup = req.body.searchMediumGroup;
    var searchSmallGroup = req.body.searchSmallGroup;
    var serachDlg = req.body.serachDlg.trim();

    var tblDlgSearch = "SELECT RNUM, GroupS, DLG_ID, DLG_TYPE, DLG_ORDER_NO, GroupL, GroupM \n";
    tblDlgSearch += "FROM (\n";
    tblDlgSearch += "SELECT RANK() OVER(ORDER BY GroupS) AS RNUM, GroupS, DLG_ID, DLG_TYPE, DLG_ORDER_NO, GroupL, GroupM \n";
    tblDlgSearch += "FROM TBL_DLG \n";
    tblDlgSearch += "WHERE 1=1\n";
    if(serachDlg) {

        tblDlgSearch += "AND GroupS like '%" + serachDlg + "%'\n";
    } else {
        
        if(searchLargeGroup) {
            tblDlgSearch += "AND GroupL = '" + searchLargeGroup + "'\n";
            if(searchMediumGroup) {
                tblDlgSearch += "AND GroupM = '" + searchMediumGroup + "'\n";
                if(searchSmallGroup) {
                    tblDlgSearch += "AND GroupS = '" + searchSmallGroup + "'\n";
                }
            }
        }
    }
    tblDlgSearch += ")A \n ORDER BY DLG_ID"

    var dlgText = "SELECT DLG_ID, CARD_TITLE, CARD_TEXT, USE_YN, '2' AS DLG_TYPE \n"
        dlgText += "FROM TBL_DLG_TEXT\n";
        dlgText += "WHERE USE_YN = 'Y'\n"
        dlgText += "AND DLG_ID IN (\n"
        dlgText += "SELECT DISTINCT DLG_ID\n"
        dlgText += "FROM TBL_DLG\n"
        dlgText += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgText += "AND GroupS like '%" + serachDlg + "%'\n";
        } else {
            if(searchLargeGroup) {
                dlgText += "AND GroupL = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgText += "AND GroupM = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgText += "AND GroupS = '" + searchSmallGroup + "'\n";
                    }
                }
            }   
        }
        dlgText += ") \n ORDER BY DLG_ID";

    var dlgCard = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, IMG_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n";
        dlgCard += "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n";
        dlgCard += "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n";
        dlgCard += "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n";
        dlgCard += "CARD_ORDER_NO, CARD_VALUE,\n";
        dlgCard += "USE_YN, '3' AS DLG_TYPE \n";
        dlgCard += "FROM TBL_DLG_CARD\n";
        dlgCard += "WHERE USE_YN = 'Y'\n";
        dlgCard += "AND DLG_ID IN (\n";
        dlgCard += "SELECT DISTINCT DLG_ID\n";
        dlgCard += "FROM TBL_DLG\n";
        dlgCard += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgCard += "AND GroupS like '%" + serachDlg + "%'\n";
        } else {

            if(searchLargeGroup) {
                dlgCard += "AND GroupL = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgCard += "AND GroupM = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgCard += "AND GroupS = '" + searchSmallGroup + "'\n";
                    }
                }
            }
        }
        dlgCard += ") \n ORDER BY DLG_ID";
    
    var dlgMedia = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, MEDIA_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n";
        dlgMedia += "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n";
        dlgMedia += "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n";
        dlgMedia += "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n";
        dlgMedia += "CARD_VALUE,\n";
        dlgMedia += "USE_YN, '4' AS DLG_TYPE \n";
        dlgMedia += "FROM TBL_DLG_MEDIA\n";
        dlgMedia += "WHERE USE_YN = 'Y'\n";
        dlgMedia += "AND DLG_ID IN (\n";
        dlgMedia += "SELECT DISTINCT DLG_ID\n";
        dlgMedia += "FROM TBL_DLG\n";
        dlgMedia += "WHERE 1=1\n";

        if(serachDlg) {
        
            dlgMedia += "AND GroupS like '%" + serachDlg + "%'\n";
        } else {

            if(searchLargeGroup) {
                dlgMedia += "AND GroupL = '" + searchLargeGroup + "'\n";
                if(searchMediumGroup) {
                    dlgMedia += "AND GroupM = '" + searchMediumGroup + "'\n";
                    if(searchSmallGroup) {
                        dlgMedia += "AND GroupS ='" + searchSmallGroup + "'\n";
                    }
                }
            }
        }
        dlgMedia += ") \n ORDER BY DLG_ID";

    (async () => {
        try{
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let dlgTextResult = await pool.request()
                .query(dlgText);
            let rowsText = dlgTextResult.recordset;

            let dlgCardResult = await pool.request()
                .query(dlgCard);
            let rowsCard = dlgCardResult.recordset;

            let dlgMediaResult = await pool.request()
                .query(dlgMedia);
            let rowsMedia = dlgMediaResult.recordset;
            
            let result1 = await pool.request()
                .query(tblDlgSearch)
            let rows = result1.recordset;
            var result = [];
            for(var i = 0; i < rows.length; i++){

                var row = {};
                row.RNUM = rows[i].RNUM;
                row.GroupS = rows[i].GroupS;
                row.DLG_ID = rows[i].DLG_ID;
                row.DLG_TYPE = rows[i].DLG_TYPE;
                row.DLG_ORDER_NO = rows[i].DLG_ORDER_NO;
                row.GroupL = rows[i].GroupL;
                row.GroupM = rows[i].GroupM;
                row.dlg = [];
                
                let dlg_type = rows[i].DLG_TYPE;
                if(dlg_type == 2){
                    for(var j = 0; j < rowsText.length; j++){
                        let textDlgId = rowsText[j].DLG_ID;
                        if(row.DLG_ID == textDlgId){
                            row.dlg.push(rowsText[j]);
                        }
                    }
                }else if(dlg_type == 3){
                    for(var j = 0; j < rowsCard.length; j++){
                        var cardDlgId = rowsCard[j].DLG_ID;
                        if(row.DLG_ID == cardDlgId){                       
                            row.dlg.push(rowsCard[j]);
                        }
                    }
                }else if(dlg_type == 4){
                    for(var j = 0; j < rowsMedia.length; j++){
                        var mediaDlgId = rowsMedia[j].DLG_ID;
                        if(row.DLG_ID == mediaDlgId){
                            row.dlg.push(rowsMedia[j]);
                        }
                    }
                }
                result.push(row);
            }

            res.send({list : result});
        
        }catch(err){
            console.log(err);
        }finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
        sql.close();
        console.log(err);
    })

});

router.post('/addDialog',function(req,res){

    var data = req.body['data[]'];
    //var luisEntities = req.body['entities[]'];
    var array = [];
    var queryText = "";
    var tblDlgId = [];
    if( typeof data == "string"){
        console.log("data is string");
        var json = JSON.parse(data);

        for( var key in json) {
            console.log("key : " + key + " value : " + json[key]);
        }
    
    } else {
        console.log("data is object");

        //array = JSON.parse(data);
        
        var dataIdx = data.length;
        
        for(var i = 0; i < dataIdx; i++) {
            array[i] = JSON.parse(data[i]);
        }
        
        for(var i = 0; i < array.length; i++) {
            for( var key in array[i]) {
                console.log("key : " + key + " value : " + array[i][key]);
            }
        }
    }

    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME='"+req.session.appName+"')\n";

    (async () => {
        try{
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            var selectDlgId = 'SELECT ISNULL(MAX(DLG_ID)+1,1) AS DLG_ID FROM TBL_DLG';
            //var selectTextDlgId = 'SELECT ISNULL(MAX(TEXT_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_TEXT';
            //var selectCarouselDlgId = 'SELECT ISNULL(MAX(CARD_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_CARD';
            //var selectMediaDlgId = 'SELECT ISNULL(MAX(MEDIA_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_MEDIA';
            //var insertTblDlg = 'INSERT INTO TBL_DLG(DLG_ID,DLG_NAME,DLG_DESCRIPTION,DLG_LANG,DLG_TYPE,DLG_ORDER_NO,USE_YN, GroupL, GroupM, DLG_GROUP) VALUES ' +
            //'(@dlgId,@dialogText,@dialogText,\'KO\',@dlgType,@dialogOrderNo,\'Y\', @largeGroup, @middleGroup, 2)';
            var insertTblDlg = 'INSERT INTO TBL_DLG(DLG_ID,DLG_NAME,DLG_DESCRIPTION,DLG_LANG,DLG_TYPE,DLG_ORDER_NO,USE_YN, GroupL, GroupM, DLG_GROUP) VALUES ' +
            '(@dlgId,@dialogText,@dialogText,\'KO\',@dlgType,@dialogOrderNo,\'Y\', @largeGroup, @predictIntent, 2)';
            var inserTblDlgText = 'INSERT INTO TBL_DLG_TEXT(DLG_ID,CARD_TITLE,CARD_TEXT,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,\'Y\')';
            var insertTblCarousel = 'INSERT INTO TBL_DLG_CARD(DLG_ID,CARD_TITLE,CARD_TEXT,IMG_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_ORDER_NO,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardOrderNo,\'Y\')';
            //var insertTblDlgMedia = 'INSERT INTO TBL_DLG_MEDIA(DLG_ID,CARD_TITLE,CARD_TEXT,MEDIA_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_VALUE,USE_YN) VALUES ' +
            //'(@dlgId,@dialogTitle,@dialogText,@mediaImgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardValue,\'Y\')';
            var insertTblDlgMedia = 'INSERT INTO TBL_DLG_MEDIA(DLG_ID,CARD_TITLE,CARD_TEXT,MEDIA_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_DIVISION,CARD_VALUE,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,@mediaImgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardDivision,@cardValue,\'Y\')';

            var largeGroup = array[array.length - 1]["largeGroup"];
            var middleGroup = array[array.length - 1]["middleGroup"];
            var description = array[array.length - 1]["description"];
            //var sourceType = array[array.length - 1]["sourceType"];
            var predictIntent = array[array.length - 1]["predictIntent"];
            /*
            var predictIntent_ = array[array.length - 1]["predictIntent"];
            var temp = predictIntent_.split("::");
            var predictIntent;
            if(temp.length==0){
                predictIntent = array[array.length - 1]["predictIntent"];
            }else{
                predictIntent = temp[0];
            }
           */
           
            for(var i = 0; i < (array.length-1); i++) {

                let result1 = await pool.request()
                .query(selectDlgId)
                let dlgId = result1.recordset;
                /*
                for(var j = 0 ; j < (typeof luisEntities ==="string" ? 1:luisEntities.length); j++) {
                    let result2 = await pool.request()
                    .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                    .input('dialogText', sql.NVarChar, description)
                    .input('dlgType', sql.NVarChar, array[i]["dlgType"])
                    .input('dialogOrderNo', sql.Int, (i+1))
                    .input('luisId', sql.NVarChar, luisId)
                    .input('luisIntent', sql.NVarChar, luisIntent)
                    .input('luisEntities', sql.NVarChar, (typeof luisEntities ==="string" ? luisEntities:luisEntities[j]))
                    .query(insertTblDlg);
                }
                */
               
               let result2 = await pool.request()
               .input('dlgId', sql.Int, dlgId[0].DLG_ID)
               .input('dialogText', sql.NVarChar, (description.trim() == '' ? null: description.trim()))
               .input('dlgType', sql.NVarChar, array[i]["dlgType"])
               .input('dialogOrderNo', sql.Int, (i+1))
               .input('largeGroup', sql.NVarChar, largeGroup)
               //.input('middleGroup', sql.NVarChar, middleGroup)
               .input('predictIntent', sql.NVarChar, predictIntent)  
               .query(insertTblDlg);
               //.input('luisEntities', sql.NVarChar, (typeof luisEntities ==="string" ? luisEntities:luisEntities[j]))
               
                if(array[i]["dlgType"] == "2") {
                    console.log("start dlgType====2");
                    /*
                    let result3 = await pool.request()
                    .query(selectTextDlgId)
                    let textDlgId = result3.recordset;
                    */

                    let result4 = await pool.request()
                    .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                    //.input('dialogTitle', sql.NVarChar, (array[i]["dialogTitle"].trim() == '' ? null: array[i]["dialogTitle"].trim()) )
                    .input('dialogTitle', sql.NVarChar, (array[i]["dialogTitle"].trim() == '' ? '': array[i]["dialogTitle"].trim()) )
                    .input('dialogText', sql.NVarChar, (array[i]["dialogText"].trim() == '' ? null: array[i]["dialogText"].trim()) )
                    .query(inserTblDlgText);                    
                    
                } else if(array[i]["dlgType"] == "3") {
                    /*
                    let result2 = await pool.request()
                    .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                    .input('dialogText', sql.NVarChar, description)
                    .input('dlgType', sql.NVarChar, array[i]["dlgType"])
                    .input('dialogOrderNo', sql.Int, (i+1))
                    .input('luisId', sql.NVarChar, luisId)
                    .input('luisIntent', sql.NVarChar, luisIntent)
                    .input('luisEntities', sql.NVarChar, luisEntities)
                    .query(insertTblDlg);
                    */

                    for (var j=0; j<array[i].carouselArr.length; j++) {
                        var carTmp = array[i].carouselArr[j];
                        
                        // 공백은 Null 처리
                        for(var key in carTmp){
                            //console.log("캐러절 key : " + key + " value : " + carTmp[key]);
                            carTmp[key] = carTmp[key].trim();
                            
                            if(carTmp[key].trim() == '') {
                                carTmp[key] = null;
                            }
                        }
                    
                        let result2 = await pool.request()
                        .input('typeDlgId', sql.NVarChar, array[i].dlgType)
                        .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                        .input('dialogTitle', sql.NVarChar, carTmp["dialogTitle"])
                        .input('dialogText', sql.NVarChar, carTmp["dialogText"])
                        .input('imgUrl', sql.NVarChar, carTmp["imgUrl"])
                        .input('btn1Type', sql.NVarChar, carTmp["btn1Type"])
                        .input('buttonName1', sql.NVarChar, carTmp["cButtonName1"])
                        .input('buttonContent1', sql.NVarChar, carTmp["cButtonContent1"])
                        .input('btn2Type', sql.NVarChar, carTmp["btn2Type"])
                        .input('buttonName2', sql.NVarChar, carTmp["cButtonName2"])
                        .input('buttonContent2', sql.NVarChar, carTmp["cButtonContent2"])
                        .input('btn3Type', sql.NVarChar, carTmp["btn3Type"])
                        .input('buttonName3', sql.NVarChar, carTmp["cButtonName3"])
                        .input('buttonContent3', sql.NVarChar, carTmp["cButtonContent3"])
                        .input('btn4Type', sql.NVarChar, carTmp["btn4Type"])
                        .input('buttonName4', sql.NVarChar, carTmp["cButtonName4"])
                        .input('buttonContent4', sql.NVarChar, carTmp["cButtonContent4"])
                        .input('cardOrderNo', sql.Int, (j+1))
                        .query(insertTblCarousel);
                        /*
                        let result2 = await pool.request()
                        .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                        .input('dialogTitle', sql.NVarChar, (carTmp["dialogTitle"] == '' ? null : carTmp["dialogTitle"]))
                        .input('dialogText', sql.NVarChar, carTmp["dialogText"])
                        .input('imgUrl', sql.NVarChar, carTmp["imgUrl"])
                        .input('btn1Type', sql.NVarChar, carTmp["btn1Type"])
                        .input('buttonName1', sql.NVarChar, (carTmp["cButtonName1"] == '' ? null : carTmp["cButtonName1"]))
                        .input('buttonContent1', sql.NVarChar, (carTmp["cButtonContent1"] == '' ? null : carTmp["cButtonContent1"]))
                        .input('btn2Type', sql.NVarChar, carTmp["btn2Type"])
                        .input('buttonName2', sql.NVarChar, (carTmp["cButtonName2"] == '' ? null : carTmp["cButtonName2"]))
                        .input('buttonContent2', sql.NVarChar, (carTmp["cButtonContent2"] == '' ? null : carTmp["cButtonContent2"]))
                        .input('btn3Type', sql.NVarChar, (carTmp["btn3Type"] == '' ? null : carTmp["btn3Type"]))
                        .input('buttonName3', sql.NVarChar, (carTmp["cButtonName3"] == '' ? null : carTmp["cButtonName3"]))
                        .input('buttonContent3', sql.NVarChar, carTmp["cButtonContent3"])
                        .input('btn4Type', sql.NVarChar, carTmp["btn4Type"])
                        .input('buttonName4', sql.NVarChar, (carTmp["cButtonName4"] == '' ? null : carTmp["cButtonName4"]))
                        .input('buttonContent4', sql.NVarChar, (carTmp["cButtonContent4"] == '' ? null : carTmp["cButtonContent4"]))
                        .input('cardOrderNo', sql.Int, (j+1))
                        .query(insertTblCarousel);
                        */

                    }

                    tblDlgId.push(dlgId[0].DLG_ID);

                } else if(array[i]["dlgType"] == "4") {
                    /*
                    let result1 = await pool.request()
                    .query(selectDlgId)
                    let dlgId = result1.recordset;

                    let result2 = await pool.request()
                    .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                    .input('dialogText', sql.NVarChar, description)
                    .input('dlgType', sql.NVarChar, array[i]["dlgType"])
                    .input('dialogOrderNo', sql.Int, (i+1))
                    .input('luisId', sql.NVarChar, luisId)
                    .input('luisIntent', sql.NVarChar, luisIntent)
                    .input('luisEntities', sql.NVarChar, luisEntities)
                    .query(insertTblDlg)

                    let result3 = await pool.request()
                    .query(selectMediaDlgId)
                    let mediaDlgId = result3.recordset;
                    */

                    // 공백은 Null 처리
                    for(var key in array[i]){
                        //console.log("카드 key : " + key + " value : " + array[i]);
                        array[i][key] = array[i][key].trim();
                        
                        if(array[i][key].trim() == '') {
                            array[i][key] = null;
                        }
                    }

                    //동영상 일때 cardDivision 컬럼에 play 가 있어야 한다.
                    //이것은 임시방편으로서 나중에는 수정을 해야 한다.
                    //수정하는 부분에도 있다....함께 고쳐야 한다.
                    var cardDivision = "";
                    if(array[i]["mediaUrl"]==""||array[i]["mediaUrl"]==null){
                        
                    }else{
                        cardDivision = "play"; 
                    }

                    let result4 = await pool.request()
                    .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                    .input('dialogTitle', sql.NVarChar, array[i]["dialogTitle"])
                    .input('dialogText', sql.NVarChar, array[i]["dialogText"])
                    .input('mediaImgUrl', sql.NVarChar, array[i]["mediaImgUrl"])
                    .input('btn1Type', sql.NVarChar, array[i]["btn1Type"])
                    .input('buttonName1', sql.NVarChar, array[i]["mButtonName1"])
                    .input('buttonContent1', sql.NVarChar, array[i]["mButtonContent1"])
                    .input('btn2Type', sql.NVarChar, array[i]["btn2Type"])
                    .input('buttonName2', sql.NVarChar, array[i]["mButtonName2"])
                    .input('buttonContent2', sql.NVarChar, array[i]["mButtonContent2"])
                    .input('btn3Type', sql.NVarChar, array[i]["btn3Type"])
                    .input('buttonName3', sql.NVarChar, array[i]["mButtonName3"])
                    .input('buttonContent3', sql.NVarChar, array[i]["mButtonContent3"])
                    .input('btn4Type', sql.NVarChar, array[i]["btn4Type"])
                    .input('buttonName4', sql.NVarChar, array[i]["mButtonName4"])
                    .input('buttonContent4', sql.NVarChar, array[i]["mButtonContent4"])
                    .input('cardDivision', sql.NVarChar, cardDivision)
                    .input('cardValue', sql.NVarChar, array[i]["mediaUrl"])
                    .query(insertTblDlgMedia)

                    tblDlgId.push(dlgId[0].DLG_ID);
                }     
                                                    
                tblDlgId.push(dlgId[0].DLG_ID);
                /*
               *luis insert-utterance / intent
               * 20180329 Jun Hyoung Park
               */
                var endPoint = HOST + "/luis/api/v2.0/apps/";
                var appId;
                let pool1 = await dbConnect.getConnection(sql);
                //let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
                let selectAppId = await pool1.request()
                    .query(selectAppIdQuery);

                for(var i = 0; i < selectAppId.recordset.length; i++) {
                    appId = selectAppId.recordset[i].APP_ID;
                } 
                
                var options = {
                    headers: {
                        'Ocp-Apim-Subscription-Key': req.session.subsKey
                    }
                };

                options.payload = {
                    "name" : predictIntent
                };
                var luisIntentsRequest = syncClient.post(endPoint + appId +'/versions/0.1/intents', options);//make intent
                /************************************************** */

            }

            res.send({list : tblDlgId});
        
        }catch(err){
            console.log(err);
        }finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
        sql.close();
        console.log(err);
    })

});




router.post('/getDlgAjax', function (req, res) {

    var entity = [];
    var dlgID = req.body.dlgID;
    var selectDlgType = " SELECT DLG_TYPE \n" +
                        " , DLG_DESCRIPTION , GROUPL , GROUPM, GROUPS\n" +
                        " FROM TBL_DLG \n" +
                        " WHERE DLG_ID=" + dlgID + " \n";

    /*
    var relationText = "SELECT RNUM, LUIS_ENTITIES, A.DLG_ID DLG_ID, B.DLG_TYPE, DLG_ORDER_NO \n";
        relationText += "FROM (\n";
        relationText += "SELECT RANK() OVER(ORDER BY LUIS_ENTITIES) AS RNUM, LUIS_ENTITIES, DLG_ID \n";
        relationText += "FROM TBL_DLG_RELATION_LUIS \n";
        relationText += "WHERE 1=1\n";
        relationText += "AND  DLG_ID=" + dlgID + " \n";
        relationText += "GROUP BY LUIS_ENTITIES, DLG_ID \n";
        relationText += ") A LEFT OUTER JOIN TBL_DLG B\n";
        relationText += "ON A.DLG_ID = B.DLG_ID \n";
        relationText += "ORDER BY LUIS_ENTITIES, DLG_ORDER_NO";
    */
    var dlgText = "SELECT DLG_ID, CARD_TITLE, CARD_TEXT, USE_YN, '2' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_TEXT\n"
                  + "WHERE 1=1 \n"
                  + "AND USE_YN = 'Y'\n"
                  + "AND DLG_ID = " + dlgID + " \n";
                  + "ORDER BY DLG_ID";

    var dlgCard = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, IMG_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
                  + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
                  + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
                  + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
                  + "CARD_ORDER_NO, CARD_VALUE,\n"
                  + "USE_YN, '3' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_CARD\n"
                  + "WHERE 1=1\n"
                  + "AND USE_YN = 'Y'\n"
                  + "AND DLG_ID = " + dlgID + " \n";
                  + "ORDER BY DLG_ID";
    
    var dlgMedia = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, MEDIA_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
                  + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
                  + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
                  + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
                  + "CARD_VALUE,\n"
                  + "USE_YN, '4' AS DLG_TYPE \n"
                  + "FROM TBL_DLG_MEDIA\n"
                  + "WHERE 1=1\n"
                  + "AND USE_YN = 'Y'\n"
                  + "AND DLG_ID = " + dlgID + " \n";
                  + "ORDER BY DLG_ID";
    

    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let dlgTextResult = await pool.request()
                .query(dlgText);
            let rowsText = dlgTextResult.recordset;

            let dlgCardResult = await pool.request()
                .query(dlgCard);
            let rowsCard = dlgCardResult.recordset;

            let dlgMediaResult = await pool.request()
                .query(dlgMedia);
            let rowsMedia = dlgMediaResult.recordset;
            
            let result1 = await pool.request()
                .query(selectDlgType)
            let rows = result1.recordset;
            var result = [];
            for(var i = 0; i < rows.length; i++){
                var row = {};
                row.DLG_TYPE = rows[i].DLG_TYPE;
                row.DLG_DESCRIPTION = rows[i].DLG_DESCRIPTION;
                row.GROUPL = rows[i].GROUPL;
                row.GROUPM = rows[i].GROUPM;
                row.GROUPS = rows[i].GROUPS;
                row.DLG_ID = dlgID;
                row.dlg = [];

                let dlg_type = rows[i].DLG_TYPE;
                if(dlg_type == 2){
                    for(var j = 0; j < rowsText.length; j++){
                        let textDlgId = rowsText[j].DLG_ID;
                        if(row.DLG_ID == textDlgId){
                            row.dlg.push(rowsText[j]);
                        }
                    }
                }else if(dlg_type == 3){
                    for(var j = 0; j < rowsCard.length; j++){
                        var cardDlgId = rowsCard[j].DLG_ID;
                        if(row.DLG_ID == cardDlgId){
                            row.dlg.push(rowsCard[j]);
                        }
                    }
                }else if(dlg_type == 4){
                    for(var j = 0; j < rowsMedia.length; j++){
                        var mediaDlgId = rowsMedia[j].DLG_ID;
                        if(row.DLG_ID == mediaDlgId){
                            row.dlg.push(rowsMedia[j]);
                        }
                    }
                }
                result.push(row);
            }

            res.send({list : result});
        
        } catch (err) {
            console.log(err);
        } finally {
            sql.close();
        }
    })()

    sql.on('error', err => {
        console.log(err);
    })
});

router.post('/deleteDialog', function (req, res) {
    var dlgId = req.body.dlgId;

    var selDlgQuery = "SELECT DLG_ID, DLG_TYPE, GROUPS FROM TBL_DLG WHERE DLG_ID = @dlgId";

    var delDlgQuery = "DELETE FROM TBL_DLG WHERE DLG_ID = @dlgId";
    var delDlgTextQuery = "DELETE FROM TBL_DLG_TEXT WHERE DLG_ID = @dlgId";
    var delDlgCardQuery = "DELETE FROM TBL_DLG_CARD WHERE DLG_ID = @dlgId";
    var delDlgMediaQuery = "DELETE FROM TBL_DLG_MEDIA WHERE DLG_ID = @dlgId";

    var delRelationQuery = "DELETE FROM TBL_DLG_RELATION_LUIS WHERE DLG_ID = @dlgId";

    var selDlgGroupSQuery = "SELECT DLG_ID FROM TBL_DLG WHERE GROUPS = @groupS ORDER BY DLG_ORDER_NO";

    var updDlgOrderQuery = "UPDATE TBL_DLG SET DLG_ORDER_NO = @order WHERE DLG_ID = @dlgId";

    var order = [];

    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let selDlg = await pool.request()
                .input('dlgId', sql.Int, dlgId)
                .query(selDlgQuery);

            let selDlgGroupS = await pool.request()
                .input('groupS', sql.NVarChar, selDlg.recordset[0].GROUPS)
                .query(selDlgGroupSQuery);

            for(var i = 0; i < selDlgGroupS.recordset.length; i++) {
                order.push(selDlgGroupS.recordset[i].DLG_ID);
            }

            if(selDlg.recordset[0].DLG_TYPE == 2) {
                let delDlgText = await pool.request()
                    .input('dlgId', sql.Int, dlgId)
                    .query(delDlgTextQuery);
            } else if(selDlg.recordset[0].DLG_TYPE == 3) {
                let delDlgCard = await pool.request()
                    .input('dlgId', sql.Int, dlgId)
                    .query(delDlgCardQuery);
            } else if(selDlg.recordset[0].DLG_TYPE == 4) {
                let delDlgMedia = await pool.request()
                    .input('dlgId', sql.Int, dlgId)
                    .query(delDlgMediaQuery);
            }

            let delDlg = await pool.request()
                .input('dlgId', sql.Int, dlgId)
                .query(delDlgQuery);

            let delRelation = await pool.request()
                .input('dlgId', sql.Int, dlgId)
                .query(delRelationQuery);

            for(var i = 0; i < order.length; i++) {
                if(order[i] == dlgId) {
                    order.splice(i,1);
                    break;
                }
            }

            var orderCount = 1;

            for(var i = 0; i < order.length; i++) {
                let updDlgOrder = await pool.request()
                .input('dlgId', sql.Int, order[i])
                .input('order', sql.Int, orderCount++)
                .query(updDlgOrderQuery);
            }

            res.send({"res":true});
        
        } catch (err) {
            console.log(err);
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {

    })

});

router.post('/updateDialog', function (req, res) {
    var dlgIdReq = req.body.dlgId;
    var dlgType = req.body.dlgType;
    var entity = req.body.entity;

    var data = req.body['data[]'];
    var array = [];
    var queryText = "";
    var tblDlgId = [];
    var order = [];
    if( typeof data == "string"){
        console.log("data is string");
        var json = JSON.parse(data);

        for( var key in json) {
            console.log("key : " + key + " value : " + json[key]);
        }
    
    } else {
        console.log("data is object");

        //array = JSON.parse(data);
        
        var dataIdx = data.length;
        
        for(var i = 0; i < dataIdx; i++) {
            array[i] = JSON.parse(data[i]);
        }
        
        for(var i = 0; i < array.length; i++) {
            for( var key in array[i]) {
                console.log("key : " + key + " value : " + array[i][key]);
            }
        }
    }

    var delDlgTextQuery = "DELETE FROM TBL_DLG_TEXT WHERE DLG_ID = @dlgId";
    var delDlgCardQuery = "DELETE FROM TBL_DLG_CARD WHERE DLG_ID = @dlgId";
    var delDlgMediaQuery = "DELETE FROM TBL_DLG_MEDIA WHERE DLG_ID = @dlgId";
    var delDlgQuery = "DELETE FROM TBL_DLG WHERE DLG_ID = @dlgId"
    
    var selDlgQuery = "SELECT DLG_ID, DLG_LANG, DLG_GROUP, DLG_TYPE, DLG_ORDER_NO, GROUPS\n";
    selDlgQuery += "FROM TBL_DLG\n";
    selDlgQuery += "WHERE DLG_ID = @dlgId";

    var selDlgGroupSQuery = "SELECT DLG_ID, DLG_LANG, DLG_GROUP, DLG_TYPE, DLG_ORDER_NO, GROUPS\n";
    selDlgGroupSQuery += "FROM TBL_DLG\n";
    selDlgGroupSQuery += "WHERE GROUPS = @groupS \n"
    selDlgGroupSQuery += "ORDER BY DLG_ORDER_NO";

    var updDlgOrderQuery = "UPDATE TBL_DLG SET DLG_ORDER_NO = @order WHERE DLG_ID = @dlgId";

    //var updDlgRelationQuery = "UPDATE TBL_DLG_RELATION_LUIS SET LUIS_ID = @luisId, LUIS_INTENT = @luisIntent WHERE DLG_ID = @dlgId";
    (async () => {
        try {

            var selectDlgId = 'SELECT ISNULL(MAX(DLG_ID)+1,1) AS DLG_ID FROM TBL_DLG';
            //var selectTextDlgId = 'SELECT ISNULL(MAX(TEXT_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_TEXT';
            //var selectCarouselDlgId = 'SELECT ISNULL(MAX(CARD_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_CARD';
            //var selectMediaDlgId = 'SELECT ISNULL(MAX(MEDIA_DLG_ID)+1,1) AS TYPE_DLG_ID FROM TBL_DLG_MEDIA';
            var insertTblDlg = 'INSERT INTO TBL_DLG(DLG_ID,DLG_NAME,DLG_DESCRIPTION,DLG_LANG,DLG_TYPE,DLG_ORDER_NO,USE_YN,GROUPL,GROUPM,GROUPS,DLG_GROUP) VALUES ' +
            '(@dlgId,@dialogText,@dialogText,\'KO\',@dlgType,@dialogOrderNo,\'Y\',@groupl,@groupm,@groups,2)';
            var inserTblDlgText = 'INSERT INTO TBL_DLG_TEXT(DLG_ID,CARD_TITLE,CARD_TEXT,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,\'Y\')';
            var insertTblCarousel = 'INSERT INTO TBL_DLG_CARD(DLG_ID,CARD_TITLE,CARD_TEXT,IMG_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_ORDER_NO,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardOrderNo,\'Y\')';
            //var insertTblDlgMedia = 'INSERT INTO TBL_DLG_MEDIA(DLG_ID,CARD_TITLE,CARD_TEXT,MEDIA_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_VALUE,USE_YN) VALUES ' +
            //'(@dlgId,@dialogTitle,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardValue,\'Y\')';
            var insertTblDlgMedia = 'INSERT INTO TBL_DLG_MEDIA(DLG_ID,CARD_TITLE,CARD_TEXT,MEDIA_URL,BTN_1_TYPE,BTN_1_TITLE,BTN_1_CONTEXT,BTN_2_TYPE,BTN_2_TITLE,BTN_2_CONTEXT,BTN_3_TYPE,BTN_3_TITLE,BTN_3_CONTEXT,BTN_4_TYPE,BTN_4_TITLE,BTN_4_CONTEXT,CARD_DIVISION,CARD_VALUE,USE_YN) VALUES ' +
            '(@dlgId,@dialogTitle,@dialogText,@imgUrl,@btn1Type,@buttonName1,@buttonContent1,@btn2Type,@buttonName2,@buttonContent2,@btn3Type,@buttonName3,@buttonContent3,@btn4Type,@buttonName4,@buttonContent4,@cardDivision,@cardValue,\'Y\')';
            var insertTblRelation = "INSERT INTO TBL_DLG_RELATION_LUIS(LUIS_ID,LUIS_INTENT,LUIS_ENTITIES,DLG_ID,DLG_API_DEFINE,USE_YN) " 
            + "VALUES( @luisId, @luisIntent, @entity, @dlgId, 'D', 'Y' ) ";

            var luisId = array[array.length - 1]["largeGroup"];
            var luisIntent = array[array.length - 1]["middleGroup"];
            var sourceType = array[array.length - 1]["sourceType"];
            var description = array[array.length - 1]["description"];

            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let selDlgRes = await pool.request()
                .input('dlgId', sql.Int, dlgIdReq)
                .query(selDlgQuery);

            let selDlg = selDlgRes.recordset;

            let selDlgGroupS = await pool.request()
                .input('groupS', sql.NVarChar, selDlg[0].GROUPS)
                .query(selDlgGroupSQuery);

            for(var gNum = 0; gNum < selDlgGroupS.recordset.length; gNum++) {
                order.push(selDlgGroupS.recordset[gNum].DLG_ID);
            }

            //selDlg[0].DLG_ID
            //tbl_dlg 삭제
            let delDlg = await pool.request()
                .input('dlgId', sql.Int, dlgIdReq)
                .query(delDlgQuery);

            //tbl_dlg text, card, media 삭제
            if(selDlg[0].DLG_TYPE == 2) {
                let delDlgText = await pool.request()
                    .input('dlgId', sql.Int, dlgIdReq)
                    .query(delDlgTextQuery);
            } else if(selDlg[0].DLG_TYPE == 3) {
                let delDlgCard = await pool.request()
                    .input('dlgId', sql.Int, dlgIdReq)
                    .query(delDlgCardQuery);
            } else if(selDlg[0].DLG_TYPE == 4) {
                let delDlgMedia = await pool.request()
                    .input('dlgId', sql.Int, dlgIdReq)
                    .query(delDlgMediaQuery);
            }

            for(var i = 0; i < (array.length-1); i++) {

                let result1 = await pool.request()
                    .query(selectDlgId)
                let dlgId = result1.recordset;

                let result2 = await pool.request()
                    .input('dlgId', sql.Int, i==0?dlgIdReq:dlgId[0].DLG_ID)
                    .input('dialogText', sql.NVarChar, description)
                    .input('dlgType', sql.NVarChar, array[i]["dlgType"])
                    .input('dialogOrderNo', sql.Int, (i+1))
                    .input('groupl', sql.NVarChar, luisId)
                    .input('groupm', sql.NVarChar, luisIntent)
                    .input('groups', sql.NVarChar, entity)
                    .query(insertTblDlg)

                if(array[i]["dlgType"] == "2") {

                    let result4 = await pool.request()
                    .input('dlgId', sql.Int, i==0?dlgIdReq:dlgId[0].DLG_ID)
                    .input('dialogTitle', sql.NVarChar, array[i]["dialogTitle"])
                    .input('dialogText', sql.NVarChar, array[i]["dialogText"])
                    .query(inserTblDlgText);                    

                } else if(array[i]["dlgType"] == "3") {

                    for (var j=0; j<array[i].carouselArr.length; j++) {
                        var carTmp = array[i].carouselArr[j];
                        
                        carTmp["btn1Type"] = (carTmp["cButtonContent1"] != "") ? carTmp["btn1Type"] : "";
                        carTmp["btn2Type"] = (carTmp["cButtonContent2"] != "") ? carTmp["btn2Type"] : "";
                        carTmp["btn3Type"] = (carTmp["cButtonContent3"] != "") ? carTmp["btn3Type"] : "";
                        carTmp["btn4Type"] = (carTmp["cButtonContent4"] != "") ? carTmp["btn4Type"] : "";

                        let result2 = await pool.request()
                        .input('dlgId', sql.Int, i==0?dlgIdReq:dlgId[0].DLG_ID)
                        .input('dialogTitle', sql.NVarChar, carTmp["dialogTitle"])
                        .input('dialogText', sql.NVarChar, carTmp["dialogText"])
                        .input('imgUrl', sql.NVarChar, carTmp["imgUrl"])
                        .input('btn1Type', sql.NVarChar, carTmp["btn1Type"])
                        .input('buttonName1', sql.NVarChar, carTmp["cButtonName1"])
                        .input('buttonContent1', sql.NVarChar, carTmp["cButtonContent1"])
                        .input('btn2Type', sql.NVarChar, carTmp["btn2Type"])
                        .input('buttonName2', sql.NVarChar, carTmp["cButtonName2"])
                        .input('buttonContent2', sql.NVarChar, carTmp["cButtonContent2"])
                        .input('btn3Type', sql.NVarChar, carTmp["btn3Type"])
                        .input('buttonName3', sql.NVarChar, carTmp["cButtonName3"])
                        .input('buttonContent3', sql.NVarChar, carTmp["cButtonContent3"])
                        .input('btn4Type', sql.NVarChar, carTmp["btn4Type"])
                        .input('buttonName4', sql.NVarChar, carTmp["cButtonName4"])
                        .input('buttonContent4', sql.NVarChar, carTmp["cButtonContent4"])
                        .input('cardOrderNo', sql.Int, (j+1))
                        .query(insertTblCarousel);

                    }

                } else if(array[i]["dlgType"] == "4") {
                     //동영상 일때 cardDivision 컬럼에 play 가 있어야 한다.
                    //이것은 임시방편으로서 나중에는 수정을 해야 한다.
                    //입력하는 부분에도 있다....함께 고쳐야 한다.
                    var cardDivision = "";
                    if(array[i]["mediaUrl"]==""||array[i]["mediaUrl"]==null){
                        
                    }else{
                        cardDivision = "play"; 
                    }
                    let result4 = await pool.request()
                    .input('dlgId', sql.Int, i==0?dlgIdReq:dlgId[0].DLG_ID)
                    .input('dialogTitle', sql.NVarChar, array[i]["dialogTitle"])
                    .input('dialogText', sql.NVarChar, array[i]["dialogText"])
                    .input('imgUrl', sql.NVarChar, array[i]["mediaImgUrl"])
                    .input('btn1Type', sql.NVarChar, array[i]["btn1Type"])
                    .input('buttonName1', sql.NVarChar, array[i]["mButtonName1"])
                    .input('buttonContent1', sql.NVarChar, array[i]["mButtonContent1"])
                    .input('btn2Type', sql.NVarChar, array[i]["btn2Type"])
                    .input('buttonName2', sql.NVarChar, array[i]["mButtonName2"])
                    .input('buttonContent2', sql.NVarChar, array[i]["mButtonContent2"])
                    .input('btn3Type', sql.NVarChar, array[i]["btn3Type"])
                    .input('buttonName3', sql.NVarChar, array[i]["mButtonName3"])
                    .input('buttonContent3', sql.NVarChar, array[i]["mButtonContent3"])
                    .input('btn4Type', sql.NVarChar, array[i]["btn4Type"])
                    .input('buttonName4', sql.NVarChar, array[i]["mButtonName4"])
                    .input('buttonContent4', sql.NVarChar, array[i]["mButtonContent4"])
                    .input('cardDivision', sql.NVarChar, cardDivision)
                    .input('cardValue', sql.NVarChar, array[i]["mediaUrl"])
                    .query(insertTblDlgMedia)

                }

                if(i != 0){
                    let insertTblRelationRes = await pool.request()
                        .input('luisId', sql.NVarChar, luisId)
                        .input('luisIntent', sql.NVarChar, luisIntent)
                        .input('entity', sql.NVarChar, entity)
                        .input('dlgId', sql.Int, dlgId[0].DLG_ID)
                        .query(insertTblRelation)
                }

                tblDlgId.push( i == 0 ? parseInt(dlgIdReq) : dlgId[0].DLG_ID);   
            }


            for(var oNum = 0 ; oNum < order.length; oNum++) {
                if(order[oNum] == tblDlgId[0]) {
                    order.splice(oNum,1);
                    order.splice(oNum,0,tblDlgId);
                    break;
                }
            }

            console.log(order);

            var orderCount = 1;

            for(var i = 0; i < order.length; i++) {

                if(Array.isArray(order[i])) {
                    for(var j = 0; j < order[i].length; j++) {
                        let updDlgOrder = await pool.request()
                        .input('order', sql.NVarChar, orderCount++)
                        .input('dlgId', sql.NVarChar, order[i][j])
                        .query(updDlgOrderQuery);
                    }
                } else {
                    let updDlgOrder = await pool.request()
                    .input('order', sql.NVarChar, orderCount++)
                    .input('dlgId', sql.NVarChar, order[i])
                    .query(updDlgOrderQuery);
                }
            }

            res.send({"res":true});
        
        } catch (err) {
            console.log(err);
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {

    })
});

router.post('/getGroupSelectBox', function (req, res) {

    var selectGroupLQuery = "SELECT DISTINCT GROUPL \n";
    selectGroupLQuery += "FROM TBL_DLG \n";
    selectGroupLQuery += "WHERE GROUPL IS NOT NULL\n";

    var selectGroupMQuery = "SELECT DISTINCT GROUPM \n";
    selectGroupMQuery += "FROM TBL_DLG \n";
    selectGroupMQuery += "WHERE GROUPM IS NOT NULL\n";

    (async () => {
        try {
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            let selectGroupL = await pool.request()
                .query(selectGroupLQuery);
            let groupL = selectGroupL.recordset;

            let selectGroupM = await pool.request()
            .query(selectGroupMQuery);
            let groupM = selectGroupM.recordset;

            res.send({"groupL" : groupL, "groupM" : groupM});
        
        } catch (err) {
            console.log(err);
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {

    })
});   
//엔티티 추가시 group selbox 조회
router.post('/selectApiGroup', function (req, res) {
    
    var entityDefine = req.body.entityDefine;
    var entityValue = req.body.entityValue;
    var apiGroup = req.body.apiGroup;
    (async () => {
        try {
            
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);

            var selectQuery  = '  SELECT API_GROUP \n';
                selectQuery += '    FROM TBL_COMMON_ENTITY_DEFINE \n';
                selectQuery += 'GROUP BY API_GROUP; \n';
            let result0 = await pool.request()
            .query(selectQuery);  

            let rows = result0.recordset;

            res.send({groupList: rows});
        
        } catch (err) {
            console.log(err);
            res.send({status:500 , message:'insert Entity Error'});
        } finally {
            sql.close();
        }
    })()
    
    sql.on('error', err => {
    })
    
});

//의도예측 change
router.post('/changeIntentAjax', function (req, res) {

    var intent = req.body.intent;

    var selRelationQuery = "SELECT A.DLG_ID  DLG_ID, DLG_TYPE, DLG_ORDER_NO, LUIS_ID, LUIS_INTENT \n";
    selRelationQuery += "FROM TBL_DLG_RELATION_LUIS A, TBL_DLG B \n";
    selRelationQuery += "WHERE LUIS_INTENT = @intent \n";
    selRelationQuery += "AND A.DLG_ID = B.DLG_ID \n";
    selRelationQuery += "AND A.USE_YN = 'Y' \n";
    selRelationQuery += "ORDER BY DLG_ORDER_NO \n";

    var selDlgTextQuery = "SELECT DLG_ID, CARD_TITLE, CARD_TEXT, '2' AS DLG_TYPE \n";
    selDlgTextQuery += "FROM TBL_DLG_TEXT \n";
    selDlgTextQuery += "WHERE DLG_ID = @dlgId \n";

    var selDlgCardQuery = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, IMG_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
        + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
        + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
        + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
        + "CARD_ORDER_NO, CARD_VALUE,\n"
        + "USE_YN, '3' AS DLG_TYPE \n"
        + "FROM TBL_DLG_CARD\n"
        + "WHERE USE_YN = 'Y'\n"
        + "AND DLG_ID = @dlgId\n"
        + "WHERE 1=1\n";

    var selDlgMediaQuery = "SELECT DLG_ID, CARD_TEXT, CARD_TITLE, MEDIA_URL, BTN_1_TYPE, BTN_1_TITLE, BTN_1_CONTEXT,\n"
        + "BTN_2_TYPE, BTN_2_TITLE, BTN_2_CONTEXT,\n"
        + "BTN_3_TYPE, BTN_3_TITLE, BTN_3_CONTEXT,\n"
        + "BTN_4_TYPE, BTN_4_TITLE, BTN_4_CONTEXT,\n"
        + "CARD_VALUE,\n"
        + "USE_YN, '4' AS DLG_TYPE \n"
        + "FROM TBL_DLG_MEDIA\n"
        + "WHERE 1=1\n"
        + "AND USE_YN = 'Y'\n"
        + "AND DLG_ID = @dlgId \n";
        + "ORDER BY DLG_ID";
    
    var result = [];

    (async () => {
        try {
        
            let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
            let selRelation = await pool.request()
                .input('intent', sql.NVarChar, intent)
                .query(selRelationQuery);

            for(var i = 0; i < selRelation.recordset.length; i++) {

                var row = {};
                row.dlg = [];
                row.LUIS_ID = selRelation.recordset[i].LUIS_ID;
                row.LUIS_INTENT = selRelation.recordset[i].LUIS_INTENT;

                if(selRelation.recordset[i].DLG_TYPE == 2) {

                    let selDlgText = await pool.request()
                        .input('dlgId', sql.NVarChar, selRelation.recordset[i].DLG_ID)
                        .query(selDlgTextQuery);
                    
                    row.dlg.push(selDlgText.recordset[0]);

                } else if(selRelation.recordset[i].DLG_TYPE == 3) {
                    
                    let selDlgCard = await pool.request()
                    .input('dlgId', sql.NVarChar, selRelation.recordset[i].DLG_ID)
                    .query(selDlgCardQuery);

                    for(var cardNum = 0 ; cardNum < selDlgCard.recordset.length; cardNum++) {
                        row.dlg.push(selDlgCard.recordset[cardNum]);
                    }

                } else if(selRelation.recordset[i].DLG_TYPE == 4) {

                    let selDlgMedia = await pool.request()
                    .input('dlgId', sql.NVarChar, selRelation.recordset[i].DLG_ID)
                    .query(selDlgMediaQuery);

                    row.dlg.push(selDlgMedia.recordset[0]);
                }

                result.push(row);
            }

            res.send({list : result});
        } catch (error) {
            console.log(error);
        }finally{
            sql.close();
        }
        
    })()
    
    sql.on('error', err => {
        console.log(err);
    })

});

//의도예측 을 위한 select box data
router.post('/predictIntentAjax', function (req, res) {
    
    var iptUtterance = req.body['iptUtterance[]'];
    var request = require('request');
    var querystring = require('querystring');
    var appId;

    var selectAppIdQuery = "SELECT CHATBOT_ID, APP_ID, VERSION, APP_NAME,CULTURE, SUBSC_KEY \n";
    selectAppIdQuery += "FROM TBL_LUIS_APP \n";
    selectAppIdQuery += "WHERE CHATBOT_ID = (SELECT CHATBOT_NUM FROM TBL_CHATBOT_APP WHERE CHATBOT_NAME='"+req.session.appName+"')\n";
    console.log("selectAppIdQuery=="+selectAppIdQuery);

    (async () => {
        try {
        
        let pool = await dbConnect.getConnection(sql);
        //let pool = await dbConnect.getAppConnection(sql, req.session.appName, req.session.dbValue);
        let selectAppId = await pool.request()
            .query(selectAppIdQuery);

        for(var i = 0; i < selectAppId.recordset.length; i++) {
            appId = selectAppId.recordset[i].APP_ID;
        } 
        //console.log("appid----"+appId);
        var endPoint = HOST + "/luis/v2.0/apps/";
        //appId = "e2693629-40e8-4769-9a38-daf5e6b56d4f";//test chat bot
        //appId = "5c4a176f-ef68-44be-beb8-f9fdfc2916c2";
        //appId = "105ee664-581f-4c3e-814f-be548e0294be;
        //console.log("appId====="+appId);
        var queryParams = {
            "subscription-key": req.session.subsKey,
            "timezoneOffset": "0",
            "verbose":  true,
            "q": iptUtterance
        }

        var options = {
            headers: {
                'Ocp-Apim-Subscription-Key': req.session.subsKey
            }
        };

        //var luisRequest_ = endPoint + appId +'?' + querystring.stringify(queryParams);
        //console.log("luisRequest_=="+luisRequest_);
        var luisRequest = syncClient.get(endPoint + appId +'?' + querystring.stringify(queryParams) , options);
        res.send(luisRequest);
        } catch (error) {
            console.log(error);
        }finally{
            sql.close();
        }
        
    })()
    
    sql.on('error', err => {
        console.log(err);
    })
});


module.exports = router;
