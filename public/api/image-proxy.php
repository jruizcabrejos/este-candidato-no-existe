<?php

declare(strict_types=1);

const MAX_BYTES = 8388608; // 8 MiB
const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_SECONDS = 4;
const REQUEST_TIMEOUT_SECONDS = 12;

$allowedTypes = [
    'image/jpeg' => true,
    'image/png' => true,
    'image/webp' => true,
];

header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

try {
    if (!extension_loaded('curl')) {
        throw new RuntimeException('El proxy necesita la extension curl de PHP.');
    }

    $url = normalize_input_url($_GET['url'] ?? '');
    $body = fetch_image_url($url, $allowedTypes);

    header('Content-Type: ' . $body['contentType']);
    header('Content-Length: ' . strlen($body['bytes']));
    header('Cache-Control: public, max-age=3600');
    echo $body['bytes'];
} catch (Throwable $error) {
    http_response_code($error instanceof InvalidArgumentException ? 400 : 502);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode([
        'error' => $error->getMessage(),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function fetch_image_url(string $url, array $allowedTypes): array
{
    $currentUrl = $url;

    for ($redirect = 0; $redirect <= MAX_REDIRECTS; $redirect++) {
        validate_public_url($currentUrl);
        $response = curl_get($currentUrl);
        $status = $response['status'];

        if ($status >= 300 && $status < 400) {
            $location = $response['headers']['location'] ?? '';
            if ($location === '') {
                throw new RuntimeException('La imagen redirige sin cabecera Location.');
            }
            $currentUrl = resolve_url($currentUrl, $location);
            continue;
        }

        if ($status < 200 || $status >= 300) {
            throw new RuntimeException('No se pudo descargar la imagen remota.');
        }

        $contentType = strtolower(trim(explode(';', $response['contentType'] ?? '')[0]));
        if (!isset($allowedTypes[$contentType])) {
            throw new InvalidArgumentException('La URL no devolvio una imagen PNG, JPG o WebP.');
        }

        return [
            'bytes' => $response['body'],
            'contentType' => $contentType,
        ];
    }

    throw new RuntimeException('La imagen excede el limite de redirecciones.');
}

function curl_get(string $url): array
{
    $headers = [];
    $body = '';
    $tooLarge = false;
    $handle = curl_init($url);

    curl_setopt_array($handle, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => CONNECT_TIMEOUT_SECONDS,
        CURLOPT_TIMEOUT => REQUEST_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => 'incaslop-candidatos-image-proxy/1.0',
        CURLOPT_HTTPHEADER => [
            'Accept: image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        ],
        CURLOPT_HEADERFUNCTION => static function ($curl, string $headerLine) use (&$headers): int {
            $length = strlen($headerLine);
            $parts = explode(':', $headerLine, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return $length;
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body, &$tooLarge): int {
            if (strlen($body) + strlen($chunk) > MAX_BYTES) {
                $tooLarge = true;
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);

    $ok = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $contentType = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    $error = curl_error($handle);
    curl_close($handle);

    if ($tooLarge) {
        throw new InvalidArgumentException('La imagen remota excede el limite de 8 MB.');
    }

    if (!$ok) {
        throw new RuntimeException($error ?: 'No se pudo leer la imagen remota.');
    }

    return [
        'status' => $status,
        'headers' => $headers,
        'contentType' => $contentType,
        'body' => $body,
    ];
}

function normalize_input_url(string $rawUrl): string
{
    $url = trim($rawUrl);
    if ($url === '') {
        throw new InvalidArgumentException('Falta el parametro url.');
    }

    if (!preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $url)) {
        $url = 'https://' . $url;
    }

    validate_public_url($url);
    return $url;
}

function validate_public_url(string $url): void
{
    $parts = parse_url($url);
    $scheme = strtolower($parts['scheme'] ?? '');
    $host = strtolower($parts['host'] ?? '');

    if (($scheme !== 'http' && $scheme !== 'https') || $host === '') {
        throw new InvalidArgumentException('Solo se aceptan URLs http o https.');
    }

    if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local')) {
        throw new InvalidArgumentException('No se aceptan hosts locales.');
    }

    $addresses = resolve_host_addresses($host);
    if (!$addresses) {
        throw new InvalidArgumentException('No se pudo resolver el host remoto.');
    }

    foreach ($addresses as $address) {
        if (!filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            throw new InvalidArgumentException('No se aceptan direcciones privadas o reservadas.');
        }
    }
}

function resolve_host_addresses(string $host): array
{
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return [$host];
    }

    $records = dns_get_record($host, DNS_A + DNS_AAAA);
    $addresses = [];

    foreach ($records ?: [] as $record) {
        if (!empty($record['ip'])) {
            $addresses[] = $record['ip'];
        }
        if (!empty($record['ipv6'])) {
            $addresses[] = $record['ipv6'];
        }
    }

    return array_values(array_unique($addresses));
}

function resolve_url(string $baseUrl, string $location): string
{
    if (preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $location)) {
        return $location;
    }

    $base = parse_url($baseUrl);
    $scheme = $base['scheme'] ?? 'https';
    $host = $base['host'] ?? '';
    $port = isset($base['port']) ? ':' . $base['port'] : '';

    if (str_starts_with($location, '//')) {
        return $scheme . ':' . $location;
    }

    if (str_starts_with($location, '/')) {
        return $scheme . '://' . $host . $port . $location;
    }

    $path = $base['path'] ?? '/';
    $directory = preg_replace('#/[^/]*$#', '/', $path);
    return $scheme . '://' . $host . $port . $directory . $location;
}
