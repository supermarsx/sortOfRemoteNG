/* Isolated SSL compatibility engine. No socket, DNS, URL or credential API.
 * stdin/stdout are bounded binary frames: tag:u8, length:u32be, payload.
 * C config, N encrypted network, P plaintext, A write acknowledgement,
 * H handshake evidence, E typed error, X orderly peer shutdown.
 * The parent alone dials and admits certificates before sending P frames.
 */
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

#define LIMIT 16384
static unsigned peer_alert;
static unsigned char pending[LIMIT];
static int pending_len;

static void put32(unsigned char *p, uint32_t n) {
    p[0]=(unsigned char)(n>>24); p[1]=(unsigned char)(n>>16);
    p[2]=(unsigned char)(n>>8); p[3]=(unsigned char)n;
}
static uint32_t get32(const unsigned char *p) {
    return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];
}
static int frame(unsigned char tag, const void *data, uint32_t len) {
    unsigned char h[5]; h[0]=tag; put32(h+1,len);
    return fwrite(h,1,5,stdout)==5 && (!len || fwrite(data,1,len,stdout)==len) && fflush(stdout)==0;
}
static int input(unsigned char *tag, unsigned char *data, uint32_t *len) {
    unsigned char h[5];
    if (fread(h,1,5,stdin)!=5) return 0;
    *tag=h[0]; *len=get32(h+1);
    return *len<=LIMIT && fread(data,1,*len,stdin)==*len;
}
static void info(const SSL *ssl, int where, int ret) {
    (void)ssl;
    if ((where & SSL_CB_ALERT) && (where & SSL_CB_READ)) peer_alert=(unsigned)ret & 255;
}
static int fail(unsigned category, unsigned value) {
    unsigned char b[8]; put32(b,category); put32(b+4,value); frame('E',b,8); return 1;
}
static int ssl_failure(void) {
    unsigned long e=ERR_peek_last_error();
    unsigned reason=ERR_GET_REASON(e);
    if (peer_alert) {
        if (peer_alert==70) return fail(1,0);
        if (peer_alert==40) return fail(8,0);
        if (peer_alert==71) return fail(9,0);
        return fail(10,peer_alert);
    }
    switch(reason) {
    case SSL_R_NO_CIPHERS_AVAILABLE: case SSL_R_NO_SHARED_CIPHER: return fail(2,0);
    case SSL_R_NO_SHARED_SIGATURE_ALGORITHMS: case SSL_R_SIGNATURE_ALGORITHMS_ERROR: return fail(3,0);
    case SSL_R_DH_KEY_TOO_SMALL: case SSL_R_MISSING_TMP_DH_KEY: case SSL_R_MISSING_TMP_ECDH_KEY: return fail(4,0);
    case SSL_R_DECRYPTION_FAILED: case SSL_R_DECRYPTION_FAILED_OR_BAD_RECORD_MAC: return fail(7,0);
    case SSL_R_UNSUPPORTED_PROTOCOL: return fail(1,0);
    case SSL_R_WRONG_VERSION_NUMBER: case SSL_R_UNKNOWN_PROTOCOL: return fail(6,0);
    default: return fail(0,(unsigned)e);
    }
}
static int drain(SSL *ssl) {
    unsigned char b[LIMIT]; int n;
    while ((n=BIO_read(SSL_get_wbio(ssl),b,sizeof(b)))>0)
        if (!frame('N',b,(uint32_t)n)) return 0;
    return 1;
}
static int evidence(SSL *ssl) {
    /* H is deliberately bounded separately from ordinary 16 KiB records. */
    unsigned char *b=malloc(1024*1024), *p=b;
    STACK_OF(X509) *chain=SSL_get_peer_cert_chain(ssl);
    X509 *leaf=SSL_get_peer_certificate(ssl);
    const char *version=SSL_get_version(ssl), *cipher=SSL_get_cipher_name(ssl);
    int i, count=chain ? sk_X509_num(chain) : 0;
    int add_leaf=leaf && (!count || X509_cmp(leaf,sk_X509_value(chain,0))!=0);
    if (!b || !leaf || count+add_leaf>16) { free(b); X509_free(leaf); return 0; }
    put32(p,(uint32_t)strlen(version)); p+=4; memcpy(p,version,strlen(version)); p+=strlen(version);
    put32(p,(uint32_t)strlen(cipher)); p+=4; memcpy(p,cipher,strlen(cipher)); p+=strlen(cipher);
    put32(p,(uint32_t)(count+add_leaf)); p+=4;
    for (i=-add_leaf;i<count;i++) {
        X509 *cert=i<0 ? leaf : sk_X509_value(chain,i);
        int n=i2d_X509(cert,NULL);
        if (n<=0 || n>65536 || p-b+4+n>1024*1024) { free(b); X509_free(leaf); return 0; }
        put32(p,(uint32_t)n); p+=4; i2d_X509(cert,&p);
    }
    i=frame('H',b,(uint32_t)(p-b)); free(b); X509_free(leaf); return i;
}

int main(int argc, char **argv) {
    unsigned char tag, b[LIMIT]; uint32_t len;
    SSL_CTX *ctx; SSL *ssl; const SSL_METHOD *method=NULL;
    int ready=0;
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY); _setmode(_fileno(stdout),_O_BINARY);
#endif
    SSL_library_init(); SSL_load_error_strings();
    if (!input(&tag,b,&len) || tag!='C' || len<3 || b[len-1]!=0) return 1;
    {
        unsigned char *sep=memchr(b,0,len-1);
        if (!sep || sep-b>16 || len-(sep-b)-1>254) return 1;
        if (!strcmp((char*)b,"ssl2")) {
#ifndef OPENSSL_NO_SSL2
            method=SSLv2_client_method();
#endif
        } else if (!strcmp((char*)b,"ssl3")) {
#ifndef OPENSSL_NO_SSL3
            method=SSLv3_client_method();
#endif
        } else if (!strcmp((char*)b,"tls10")) method=TLSv1_client_method();
        else if (!strcmp((char*)b,"tls11")) method=TLSv1_1_client_method();
        else if (!strcmp((char*)b,"legacy")) method=SSLv23_client_method();
#ifdef SORNG_TLS_TEST_SERVER
        if (!strcmp((char*)b,"ssl2")) method=SSLv2_server_method();
        else if (!strcmp((char*)b,"ssl3")) method=SSLv3_server_method();
        else if (!strcmp((char*)b,"tls10")) method=TLSv1_server_method();
        else if (!strcmp((char*)b,"tls11")) method=TLSv1_1_server_method();
        else if (!strcmp((char*)b,"legacy")) method=SSLv23_server_method();
#else
        (void)argc; (void)argv;
#endif
        if (!method) return fail(11,0);
        ctx=SSL_CTX_new(method);
        if (!ctx) return ssl_failure();
        /* Certificate admission belongs to the parent, after evidence H. */
        SSL_CTX_set_verify(ctx,SSL_VERIFY_NONE,NULL);
        SSL_CTX_set_session_cache_mode(ctx,SSL_SESS_CACHE_OFF);
        SSL_CTX_set_options(ctx,SSL_OP_NO_TICKET | SSL_OP_NO_SSLv2);
        if (!strcmp((char*)b,"ssl2")) SSL_CTX_clear_options(ctx,SSL_OP_NO_SSLv2);
        if (!SSL_CTX_set_cipher_list(ctx,"ALL:!aNULL:!eNULL")) return ssl_failure();
#ifdef SORNG_TLS_TEST_SERVER
        if (argc!=3 || SSL_CTX_use_certificate_file(ctx,argv[1],SSL_FILETYPE_PEM)!=1 || SSL_CTX_use_PrivateKey_file(ctx,argv[2],SSL_FILETYPE_PEM)!=1) return ssl_failure();
#endif
        ssl=SSL_new(ctx);
        if (!ssl) return ssl_failure();
        SSL_set_info_callback(ssl,info);
#ifndef SORNG_TLS_TEST_SERVER
        if (sep[1] && strcmp((char*)b,"ssl2")) SSL_set_tlsext_host_name(ssl,(char*)sep+1);
#endif
    }
    SSL_set_bio(ssl,BIO_new(BIO_s_mem()),BIO_new(BIO_s_mem()));
    BIO_set_mem_eof_return(SSL_get_rbio(ssl),-1);
    SSL_set_connect_state(ssl);
#ifdef SORNG_TLS_TEST_SERVER
    SSL_set_accept_state(ssl);
#endif
    for (;;) {
        int n, err;
        if (!ready) {
            n=SSL_do_handshake(ssl);
            err=n==1 ? SSL_ERROR_NONE : SSL_get_error(ssl,n);
            if (!drain(ssl)) break;
            if (n==1) {
#ifdef SORNG_TLS_TEST_SERVER
                if (!frame('H',NULL,0)) break;
#else
                if (!evidence(ssl)) { fail(12,0); break; }
#endif
                ready=1;
            }
            else if (err!=SSL_ERROR_WANT_READ && err!=SSL_ERROR_WANT_WRITE) { ssl_failure(); break; }
        }
        if (ready && pending_len) {
            n=SSL_write(ssl,pending,pending_len);
            err=n>0 ? SSL_ERROR_NONE : SSL_get_error(ssl,n);
            if (!drain(ssl)) break;
            if (n==pending_len) { pending_len=0; if (!frame('A',NULL,0)) break; }
            else if (err!=SSL_ERROR_WANT_READ && err!=SSL_ERROR_WANT_WRITE) { ssl_failure(); break; }
        }
        if (ready) {
            for (;;) {
                n=SSL_read(ssl,b,sizeof(b));
                err=n>0 ? SSL_ERROR_NONE : SSL_get_error(ssl,n);
                if (!drain(ssl)) goto done;
                if (n>0) { if (!frame('P',b,(uint32_t)n)) goto done; }
                else {
                    if (err==SSL_ERROR_ZERO_RETURN) { frame('X',NULL,0); goto done; }
                    if (err!=SSL_ERROR_WANT_READ && err!=SSL_ERROR_WANT_WRITE) { ssl_failure(); goto done; }
                    break;
                }
            }
        }
        if (!input(&tag,b,&len)) break;
        if (tag=='N' && len) { if (BIO_write(SSL_get_rbio(ssl),b,(int)len)!=(int)len) break; }
        else if (tag=='P' && ready && len && !pending_len) { memcpy(pending,b,len); pending_len=(int)len; }
        else { fail(12,0); break; }
    }
done:
    SSL_free(ssl); SSL_CTX_free(ctx); return 0;
}
