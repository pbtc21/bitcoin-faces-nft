;; Bitcoin Faces NFT - SIP-009 Compliant
;; Unique Bitcoin Face NFTs generated from Stacks addresses

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; Constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant ERR_NOT_AUTHORIZED (err u1001))
(define-constant ERR_NOT_FOUND (err u1002))
(define-constant ERR_ALREADY_MINTED (err u1003))
(define-constant ERR_INVALID_ADDRESS (err u1004))

;; Data vars
(define-data-var last-token-id uint u0)
(define-data-var base-uri (string-ascii 256) "https://bitcoin-faces.pbtc21.dev/metadata/")

;; NFT definition
(define-non-fungible-token bitcoin-face uint)

;; Maps
(define-map token-uris uint (string-ascii 256))
(define-map address-to-token principal uint)
(define-map token-to-address uint principal)
(define-map minters principal bool)

;; Read-only functions

;; SIP-009: Get last token ID
(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

;; SIP-009: Get token URI
(define-read-only (get-token-uri (token-id uint))
  (ok (map-get? token-uris token-id))
)

;; SIP-009: Get token owner
(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? bitcoin-face token-id))
)

;; Get token ID for an address (if minted)
(define-read-only (get-token-for-address (address principal))
  (map-get? address-to-token address)
)

;; Get address for a token ID
(define-read-only (get-address-for-token (token-id uint))
  (map-get? token-to-address token-id)
)

;; Check if address has already minted
(define-read-only (has-minted (address principal))
  (is-some (map-get? address-to-token address))
)

;; Check if principal is authorized minter
(define-read-only (is-minter (address principal))
  (default-to false (map-get? minters address))
)

;; SIP-009: Transfer
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_AUTHORIZED)
    (nft-transfer? bitcoin-face token-id sender recipient)
  )
)

;; Mint a Bitcoin Face NFT
;; Can only mint one per address (deterministic based on address)
(define-public (mint (recipient principal))
  (let
    (
      (new-token-id (+ (var-get last-token-id) u1))
      (uri (concat (var-get base-uri) (principal-to-address-string recipient)))
    )
    ;; Only owner or authorized minters can mint
    (asserts! (or (is-eq tx-sender CONTRACT_OWNER) (is-minter tx-sender)) ERR_NOT_AUTHORIZED)
    ;; Check if address already has a Bitcoin Face
    (asserts! (is-none (map-get? address-to-token recipient)) ERR_ALREADY_MINTED)
    ;; Mint the NFT
    (try! (nft-mint? bitcoin-face new-token-id recipient))
    ;; Update state
    (var-set last-token-id new-token-id)
    (map-set token-uris new-token-id uri)
    (map-set address-to-token recipient new-token-id)
    (map-set token-to-address new-token-id recipient)
    (ok new-token-id)
  )
)

;; Helper to convert principal to string for URI
;; Note: This is a simplified version - in production you'd want proper encoding
(define-private (principal-to-address-string (address principal))
  ;; For now, we store the full URI in the map
  ;; The actual address string conversion would require more complex logic
  ""
)

;; Mint with explicit URI (for the minting service)
(define-public (mint-with-uri (recipient principal) (uri (string-ascii 256)))
  (let
    (
      (new-token-id (+ (var-get last-token-id) u1))
    )
    ;; Only owner or authorized minters can mint
    (asserts! (or (is-eq tx-sender CONTRACT_OWNER) (is-minter tx-sender)) ERR_NOT_AUTHORIZED)
    ;; Check if address already has a Bitcoin Face
    (asserts! (is-none (map-get? address-to-token recipient)) ERR_ALREADY_MINTED)
    ;; Mint the NFT
    (try! (nft-mint? bitcoin-face new-token-id recipient))
    ;; Update state
    (var-set last-token-id new-token-id)
    (map-set token-uris new-token-id uri)
    (map-set address-to-token recipient new-token-id)
    (map-set token-to-address new-token-id recipient)
    (ok new-token-id)
  )
)

;; Admin: Add authorized minter
(define-public (add-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_AUTHORIZED)
    (ok (map-set minters minter true))
  )
)

;; Admin: Remove authorized minter
(define-public (remove-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_AUTHORIZED)
    (ok (map-delete minters minter))
  )
)

;; Admin: Update base URI
(define-public (set-base-uri (new-uri (string-ascii 256)))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_AUTHORIZED)
    (ok (var-set base-uri new-uri))
  )
)
