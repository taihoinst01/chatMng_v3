'use strict';
var express = require('express');
var router = express.Router();

/* GET users listing. */
router.get('/dashboard', function (req, res) {
    req.session.selMenu = 'm2'; 
    var appName = req.param('appName');
    res.render('dashboard',
        {
            appName: appName,
            title: 'Express',
            selMenu: 'm2',
            list: [
                {
                    'title': '첫번째 게시물',
                    'writer': '에이다',
                    'date': '2017-12-27',
                },
                {
                    'title': '두번째 게시물',
                    'writer': '퀀텀',
                    'date': '2017-12-28',
                },
                {
                    'title': '세번째 게시물',
                    'writer': 'Jonber',
                    'date': '2017-12-28',
                }
            ]
        });
});

module.exports = router;
