
$(document).ready(function () {

    $('#mLoginId').focus();

    $('#sendLoginBtn').click(function () {
        $('#loginfrm').submit();
    });

    $('#mLoginPass, #mLoginId').keyup(function(e){
        if(e.keyCode == 13) {
            $('#sendLoginBtn').click();
        }
    });
})
