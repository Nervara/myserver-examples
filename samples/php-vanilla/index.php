<?php
if ($_SERVER['REQUEST_URI'] === '/health') {
    echo "OK";
    exit;
}

$port = getenv('PORT') ?: 80;
echo "Hello from Vanilla PHP on Railpack! Port: " . $port;
