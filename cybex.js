const PrivateKey = require('./ecc/src/PrivateKey');
const TransactionBuilder = require('./serializer/TransactionBuilder');
const {generateKeys} = require("./ecc/src/AccountLogin");

const {fetch, Request, Response, Headers} = require('fetch-ponyfill')({});

function block_params(ref_block_id) {
    const ref_block_num = parseInt(ref_block_id.substring(0, 8), 16) & 0xffff;
    const ref_block_prefix = new Buffer.from(ref_block_id, "hex").readUInt32LE(4);

    return {ref_block_num: ref_block_num, ref_block_prefix: ref_block_prefix}
}

class CybexSigner {

    constructor(account, key, chain_id, ref_block_id) {
        this.user = {id: account};
        this.wifKey = key;
        this.pKey = PrivateKey.fromWif(this.wifKey);

        this.fee_asset_id = "1.3.0";
        this.chain_id = chain_id ? chain_id : "90be01e82b981c8f201c9a78a3d31f655743b29ff3274727b1439b093d04aa23";
        const ref_block = ref_block_id ? ref_block_id : "00b803c9b121dbb369d17cf68d125884f22a0190";
        this.params = block_params(ref_block);
    }

    set_chain_params(chain_id, ref_block_id) {
        this.chain_id = chain_id ? chain_id : "90be01e82b981c8f201c9a78a3d31f655743b29ff3274727b1439b093d04aa23";
        const ref_block = ref_block_id ? ref_block_id : "00b803c9b121dbb369d17cf68d125884f22a0190";
        this.params = block_params(ref_block);
    }

    op_sign(type_name, obj, trx_id) {

        let tr = new TransactionBuilder();

        tr.ref_block_num = this.params.ref_block_num;
        tr.ref_block_prefix = this.params.ref_block_prefix;

        tr.add_type_operation(type_name, obj);

        const sig = tr.sign_with_key(this.chain_id, this.pKey);

        if (type_name === "limit_order_create") {
            console.log(obj);

            return {
                transactionType: "NewLimitOrder",
                transactionId: tr.id(),
                refBlockNum: this.params.ref_block_num,
                refBlockPrefix: this.params.ref_block_prefix,
                txExpiration: tr.expiration,
                fee: {assetId: this.fee_asset_id, amount: 55},
                seller: obj.seller,
                amountToSell: {"assetId": obj.amount_to_sell.asset_id, amount: obj.amount_to_sell.amount},
                minToReceive: {"assetId": obj.min_to_receive.asset_id, amount: obj.min_to_receive.amount},
                expiration: obj.expiration,
                signature: sig,
                fill_or_kill: obj.fill_or_kill?1:0,
                isBuy: 0
            };

        } else if (type_name === "limit_order_cancel") {

            return {
                transactionType: "Cancel",
                transactionId: tr.id(),
                originalTransactionId: trx_id,
                refBlockNum: this.params.ref_block_num,
                refBlockPrefix: this.params.ref_block_prefix,
                txExpiration: tr.expiration,
                orderId: '0',
                fee: {assetId: this.fee_asset_id, amount: 5},
                feePayingAccount: this.user.id,
                signature: sig,
            };

        } else if (type_name === "cancel_all") {

            return {
                transactionType: "CancelAll",
                transactionId: tr.id(),
                refBlockNum: this.params.ref_block_num,
                refBlockPrefix: this.params.ref_block_prefix,
                txExpiration: tr.expiration,
                fee: {assetId: this.fee_asset_id, amount: 50},
                seller: this.user.id,
                sellAssetId: obj.sell_asset_id,
                recvAssetId: obj.receive_asset_id,
                signature: sig,
            };
        }
    }

    // queryAsset(assetid){
    //     return {"precision":3};
    // }

    // assetAmount(asset, amount) {
    //     return parseFloat((amount / Math.pow(10, asset.precision)).toFixed(asset.precision))
    // }
    // assetAmountRaw(asset, amount) {
    //     return
    // }

    limit_order_create(pair, side, price, amount, total = null) {
        const base_id = pair.base.assetId;
        const quote_id = pair.quote.assetId;
        try {
            // calculate utc end of day
            const end = new Date();
            end.setHours(23, 59, 59, 999);
            const exp = Math.floor(end / 1000) + 1;

            // calculate buy sell
            let sell, buy;
            let quote_amount = parseInt(amount * Math.pow(10, pair.quote.precision));//this.assetAmountRaw(quote_id, amount)
            if (!total) {
                total = amount * price
            }
            let base_amount = parseInt(amount * Math.pow(10, pair.base.precision));//this.assetAmountRaw(base_id, total)
            let base = {
                asset_id: base_id,
                amount: base_amount
            };
            let quote = {
                asset_id: quote_id,
                amount: quote_amount
            };
            if (side === "buy") {
                sell = base;
                buy = quote
            } else {
                sell = quote;
                buy = base
            }

            let obj = {
                "seller": this.user.id,
                "amount_to_sell": sell,
                "min_to_receive": buy,
                "expiration": exp,
                "fill_or_kill": false,
                "fee": {
                    "amount": 55,
                    "asset_id": this.fee_asset_id
                },
            };

            return this.op_sign("limit_order_create", obj);

        } catch (e) {
            console.error(e)
        }
    }

    limit_order_cancel(trx_id) {
        try {
            let obj = {
                "fee_paying_account": this.user.id,
                "order": "1.7.0",
                "fee": {
                    "amount": 5,
                    "asset_id": this.fee_asset_id
                },
                "extensions": [
                    [6, {"trx_id": trx_id}]
                ]
            }
            return this.op_sign("limit_order_cancel", obj, trx_id)

        } catch (e) {
            console.error(e)
        }
    }

    cancel_all(pair) {
        const base_id = pair.base.assetId;
        const quote_id = pair.quote.assetId;
        try {
            let obj = {
                "seller": this.user.id,
                "fee": {
                    "amount": 5,
                    "asset_id": this.fee_asset_id
                },
                "sell_asset_id": quote_id,
                "receive_asset_id": base_id
            }
            return this.op_sign("cancel_all", obj)

        } catch (e) {
            console.error(e)
        }
    }
}

class Cybex {
    constructor(accountName = undefined, account = undefined, key = undefined, environ = "prod", verbose=true) {
        this.apiEndPoint = environ==='prod'?"https://api.cybex.io/v1/":"https://apitest.cybex.io/v1/";
        this.accountName = accountName;
        this.setSigner(account, key);
        this.loaded = false;
        this.verbose=verbose;

        // const pkey = generateKeys(accountName,password)
        // const key = pkey.toWif()
    }

    executeRestRequest(url, method = 'GET', data = undefined) {
        if(this.verbose&&data){
            console.log(data);
        }
        return fetch(url, { method: method, body: JSON.stringify(data), headers: {'Content-type': 'application/json'} })
            .catch(error=>{
                console.log(error);
            })
            .then(res => res.json());
    }

    setSigner(account, key){
        if (account && key) {
            this.signer = new CybexSigner(account, key);
        }
    }

    async get_pair(assetPair) {

        if(!this.loaded){
            const res = await this.loadMarkets()
        }

        var result = this.availableAssetPairs.filter(pair => {
            return pair.name === assetPair
        })
        if (result.length === 1) {
            const _pair = assetPair.split("/");
            const matched = result[0];

            var match_base = this.availableAssets.filter(asset => {
                return asset.assetName === _pair[0]
            })

            var match_quote = this.availableAssets.filter(asset => {
                return asset.assetName === _pair[1]
            })

            if (match_base.length === 1 && match_quote.length === 1) {
                matched.base = match_base[0];
                matched.quote = match_quote[0];
            }
            return matched
        }

        return null;

    }

    async loadMarkets(reload=false) {
        if(reload||!this.loaded){
            return await this.fetchMarkets();
        }
    }

    async fetchMarkets() {
        const url = this.apiEndPoint + "refData";

        const res = await this.executeRestRequest(url).then(res => {

            this.chainId = res.chainId;
            this.refBlockId = res.refBlockId;
            this.availableAssets = res.availableAssets;
            this.availableAssetPairs = res.availableAssetPairs;

            if (this.signer) {
                this.signer.set_chain_params(res.chainId, res.refBlockId);
            }
            this.loaded = true;
        });

        return this.availableAssetPairs
    }

    async fetchOrderBook(assetPair, limit=3) {
        const url = this.apiEndPoint + "orderBook?assetPair="+assetPair+"&limit="+limit;

        return await this.executeRestRequest(url)
    }

    async fetchOHLCV(assetPair, interval="1h") {

        const url = this.apiEndPoint + "klines?assetPair="+assetPair+"&interval="+interval;
        return await this.executeRestRequest(url)

    }

    async fetchTrades(assetPair, reverse=true, limit=10) {
        const url = this.apiEndPoint + "trade?assetPair="+assetPair+"&reverse="+reverse+"&limit="+limit;
        return await this.executeRestRequest(url)
    }

    // Private

    async fetchBalance(accountName) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const url = this.apiEndPoint + "position?accountName="+accName;
            return await this.executeRestRequest(url)
        }
        return [];

    }

    async fetchBestPrice(assetPair){
        const orderbook = await this.fetchOrderBook(assetPair, 1);
        return {bid:orderbook.bids[0][0], ask:orderbook.asks[0][0]}

    }

    async createOrder(assetPair, side, amount, price) {

        if(this.signer){
            if(!this.loaded){
                const res = await this.loadMarkets()
            }

            const parsed = await this.get_pair(assetPair);
            const total = amount*price;

            if( parsed.minQuantity && (amount<parsed.minQuantity)){
                console.log("Mininum quantity is "+parsed.minQuantity);
                return
            }
            if( parsed.minTickSize && (total<parsed.minTickSize)){
                console.log("Mininum minTickSize is "+parsed.minQuantity);
                return
            }
            const signedTx = this.signer.limit_order_create(parsed, side, price, amount, total);
            //signedTx.isBuy = side==="buy"?1:0;
            const url = this.apiEndPoint + "transaction";

            const res = await this.executeRestRequest(url, "POST", signedTx);
            if(res.Status === 'Successful'){
                res.transactionId=signedTx.transactionId;
                return res;
            }
            console.log(res);
        }
    }

    async createLimitBuyOrder(assetPair, amount, price) {
        return this.createOrder(assetPair, "buy", amount, price);
    }

    async createLimitSellOrder(assetPair, amount, price) {

        return this.createOrder(assetPair, "sell", amount, price);
    }

    async createMarketBuyOrder(assetPair, amount) {
        const bestPrice = await this.fetchBestPrice(assetPair);
        return this.createOrder(assetPair, "buy", amount, bestPrice.ask*1.01);
    }

    async createMarketSellOrder(assetPair, amount) {
        const bestPrice = await this.fetchBestPrice(assetPair);
        return this.createOrder(assetPair, "sell", amount, bestPrice.bid*0.99);
    }

    async cancelOrder(trx_id) {
        if(this.signer){

            if(!this.loaded){
                const res = await this.loadMarkets()
            }

            const signedTx = this.signer.limit_order_cancel(trx_id);

            const url = this.apiEndPoint + "transaction";

            return await this.executeRestRequest(url, "POST", signedTx);
        }
    }

    async cancelAll(assetPair) {
        if(this.signer){
            if(!this.loaded){
                const res = await this.loadMarkets()
            }

            const parsed = await this.get_pair(assetPair);

            const signedTx = this.signer.cancel_all(parsed)

            const url = this.apiEndPoint + "transaction"
            return await this.executeRestRequest(url, "POST", signedTx);
        }
    }

    async fetchOrder(trx_id, accountName) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const url = this.apiEndPoint + "order?accountName="+accName+"&transactionId="+trx_id;
            return await this.executeRestRequest(url)
        }
    }

    async fetchOrders(assetPair, accountName, reverse=true) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const _pairStr = assetPair?"&assetPair="+assetPair:"";
            const url = this.apiEndPoint + "order?accountName="+accName+_pairStr+"&reverse="+reverse;
            return await this.executeRestRequest(url)
        }
    }

    async fetchOpenOrders(assetPair, accountName, reverse=true) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const _pairStr = assetPair?"&assetPair="+assetPair:"";
            const url = this.apiEndPoint + "order?accountName="+accName +_pairStr+"&orderStatus=OPEN, PENDING_NEW, PENDING_CXL"+"&reverse="+reverse;
            return await this.executeRestRequest(url)
        }
    }

    async fetchClosedOrders(assetPair, accountName, reverse=true) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const url = this.apiEndPoint + "order?accountName="+accName+_pairStr+"&orderStatus=FILLED, CANCELED, REJECTED"+"&reverse="+reverse;
            return await this.executeRestRequest(url)
        }
    }

    async fetchMyTrades(assetPair, accountName, reverse=true) {
        const accName = accountName?accountName:this.accountName;
        if(accName){
            const _pairStr = assetPair?"&assetPair="+assetPair:"";
            const url = this.apiEndPoint + "trade?accountName="+accName+_pairStr+"&reverse="+reverse;
            return await this.executeRestRequest(url)
        }
    }
}

module.exports = Cybex;

